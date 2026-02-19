import * as Babel from "@babel/standalone";

const INTERNAL_NAME_RE = /^(?:__|_o|_a)/;

function shouldRecordRoot(name: string) {
  return !INTERNAL_NAME_RE.test(name);
}

function checkpointStartIdOf(node: any): string {
  const line = node.loc?.start?.line ?? 1;     // Babel line は 1-based
  const col0 = node.loc?.start?.column ?? 0;   // Babel column は 0-based
  const col1 = col0 + 1;                       // Monaco 用に 1-basedへ
  return `L${line}:${col1}`;
}

function checkpointAfterIdOf(node: any): string {
  const line = node.loc?.end?.line ?? node.loc?.start?.line ?? 1;
  const col0 = node.loc?.end?.column ?? node.loc?.start?.column ?? 0;
  const col1 = col0 + 1;
  return `L${line}:${col1}`;
}

// 「計装が生成した stmt」を識別するフラグ
const GEN = "__gen__";
function markGen<T>(node: T): T {
  (node as any)[GEN] = true;
  return node;
}
function isGen(node: any): boolean {
  return !!node && (node as any)[GEN] === true;
}

export function instrument(code: string): string {
  const instrumentPlugin = (babel: any) => {
    const t = babel.types;

    const ensureBlock = (p: any, key: string) => {
      const sub = p.get(key);
      if (!sub || sub.isBlockStatement()) return;
      sub.replaceWith(t.blockStatement([sub.node]));
    };

    const mkRootSetStmt = (name: string, checkpointId: string) =>
      markGen(
        t.expressionStatement(
          t.callExpression(t.identifier("__setVar"), [
            t.stringLiteral(name),
            t.identifier(name),
            t.stringLiteral(checkpointId),
          ])
        )
      );

    const withCheckpointExpr = (expr: any, checkpointId: string) => {
      const tmp = t.identifier("__cp_result");
      return t.callExpression(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.variableDeclaration("const", [t.variableDeclarator(tmp, t.cloneNode(expr, true))]),
            t.expressionStatement(
              t.callExpression(t.identifier("__checkpoint"), [t.stringLiteral(checkpointId)])
            ),
            t.returnStatement(t.cloneNode(tmp)),
          ])
        ),
        []
      );
    };

    const collectIdsFromPattern = (node: any, out: Set<string>) => {
      if (!node) return;
      if (t.isIdentifier(node)) {
        if (shouldRecordRoot(node.name)) out.add(node.name);
        return;
      }
      if (t.isObjectPattern(node)) {
        for (const p of node.properties) {
          if (t.isRestElement(p)) collectIdsFromPattern(p.argument, out);
          else if (t.isObjectProperty(p)) collectIdsFromPattern(p.value, out);
        }
        return;
      }
      if (t.isArrayPattern(node)) {
        for (const e of node.elements) {
          if (!e) continue;
          if (t.isRestElement(e)) collectIdsFromPattern(e.argument, out);
          else collectIdsFromPattern(e, out);
        }
        return;
      }
      if (t.isAssignmentPattern(node)) {
        collectIdsFromPattern(node.left, out);
      }
    };

    const inferFunctionName = (path: any): string => {
      const n = path.node;
      if (t.isFunctionDeclaration(n) && n.id?.name) return n.id.name;
      if (t.isFunctionExpression(n) && n.id?.name) return n.id.name;
      if ((t.isClassMethod(n) || t.isObjectMethod(n)) && t.isIdentifier(n.key)) return n.key.name;
      if (path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id)) {
        return path.parentPath.node.id.name;
      }
      if (
        path.parentPath?.isAssignmentExpression() &&
        t.isIdentifier(path.parentPath.node.left)
      ) {
        return path.parentPath.node.left.name;
      }
      return "anonymous";
    };

    return {
      visitor: {
        Function(path: any) {
          if (path.findParent((p: any) => isGen(p.node))) return;
          if (path.isArrowFunctionExpression() && !path.get("body").isBlockStatement()) {
            const expr = path.get("body").node;
            path.get("body").replaceWith(t.blockStatement([t.returnStatement(expr)]));
          }

          const bodyPath = path.get("body");
          if (!bodyPath?.isBlockStatement?.()) return;

          const localNames = new Set<string>();
          for (const p of path.node.params ?? []) collectIdsFromPattern(p, localNames);

          path.traverse({
            Function(inner: any) {
              if (inner !== path) inner.skip();
            },
            VariableDeclarator(vp: any) {
              collectIdsFromPattern(vp.node.id, localNames);
            },
            CatchClause(cp: any) {
              collectIdsFromPattern(cp.node.param, localNames);
            },
          });

          const fnName = inferFunctionName(path);
          const cpStartId = checkpointStartIdOf(path.node);
          const cpEndId = checkpointAfterIdOf(path.node);
          const cleanup = Array.from(localNames)
            .sort()
            .map((name) =>
              markGen(
                t.expressionStatement(
                  t.callExpression(t.identifier("__deleteVar"), [
                    t.stringLiteral(name),
                    t.stringLiteral(cpEndId),
                  ])
                )
              )
            );

          const enter = markGen(
            t.expressionStatement(
              t.callExpression(t.identifier("__callEnter"), [
                t.stringLiteral(fnName),
                t.stringLiteral(cpStartId),
              ])
            )
          );
          const exit = markGen(
            t.expressionStatement(
              t.callExpression(t.identifier("__callExit"), [
                t.stringLiteral(fnName),
                t.stringLiteral(cpEndId),
              ])
            )
          );

          const originalBody = bodyPath.node;
          bodyPath.replaceWith(
            t.blockStatement([
              enter,
              t.tryStatement(originalBody, null, t.blockStatement(cleanup)),
            ])
          );
          const replacedBody = bodyPath.node.body;
          const tryStmt = replacedBody[replacedBody.length - 1];
          if (t.isTryStatement(tryStmt) && t.isBlockStatement(tryStmt.finalizer)) {
            tryStmt.finalizer.body.unshift(exit);
          }
        },

        IfStatement(path: any) {
          ensureBlock(path, "consequent");
          const alt = path.get("alternate");
          if (alt && alt.node && !alt.isBlockStatement() && !alt.isIfStatement()) {
            alt.replaceWith(t.blockStatement([alt.node]));
          }
        },
        ForStatement(path: any) { ensureBlock(path, "body"); },
        WhileStatement(path: any) { ensureBlock(path, "body"); },
        DoWhileStatement(path: any) { ensureBlock(path, "body"); },
        ForInStatement(path: any) { ensureBlock(path, "body"); },
        ForOfStatement(path: any) { ensureBlock(path, "body"); },

        // {a: e1, b: e2} を IIFE 展開
        ObjectExpression(path: any) {
          // 自分が生成した __val({}) の {} は触らない
          if (
            path.parentPath?.isCallExpression() &&
            t.isIdentifier(path.parent.callee, { name: "__val" }) &&
            path.node.properties.length === 0
          ) {
            return;
          }

          const checkpointId = checkpointStartIdOf(path.node);
          // ★内部名は _o に寄せる（root記録フィルタが確実に当たる）
          const tmp = path.scope.generateUidIdentifier("_o");
          const stmts: any[] = [];

          stmts.push(
            markGen(
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  tmp,
                  t.callExpression(t.identifier("__val"), [t.objectExpression([])])
                ),
              ])
            )
          );

          for (const p of path.node.properties) {
            if (t.isObjectProperty(p)) {
              let keyExpr;
              if (t.isIdentifier(p.key) && !p.computed) keyExpr = t.stringLiteral(p.key.name);
              else if (t.isStringLiteral(p.key) && !p.computed) keyExpr = t.stringLiteral(p.key.value);
              else keyExpr = p.key;

              stmts.push(
                markGen(
                  t.expressionStatement(
                    t.callExpression(t.identifier("__writeProp"), [
                      tmp,
                      keyExpr,
                      p.value,
                      t.stringLiteral(checkpointId),
                    ])
                  )
                )
              );
            }
          }

          stmts.push(t.returnStatement(tmp));

          path.replaceWith(
            t.callExpression(t.arrowFunctionExpression([], t.blockStatement(stmts)), [])
          );
        },

        // [e1, e2] を IIFE 展開
        ArrayExpression(path: any) {
          if (
            path.parentPath?.isCallExpression() &&
            t.isIdentifier(path.parent.callee, { name: "__val" }) &&
            path.node.elements.length === 0
          ) {
            return;
          }

          const checkpointId = checkpointStartIdOf(path.node);
          const tmp = path.scope.generateUidIdentifier("_a");
          const stmts: any[] = [];

          stmts.push(
            markGen(
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  tmp,
                  t.callExpression(t.identifier("__val"), [t.arrayExpression([])])
                ),
              ])
            )
          );

          path.node.elements.forEach((el: any, i: number) => {
            if (!el) return;
            stmts.push(
              markGen(
                t.expressionStatement(
                  t.callExpression(t.identifier("__writeProp"), [
                    tmp,
                    t.stringLiteral(String(i)),
                    el,
                    t.stringLiteral(checkpointId),
                  ])
                )
              )
            );
          });

          stmts.push(t.returnStatement(tmp));

          path.replaceWith(
            t.callExpression(t.arrowFunctionExpression([], t.blockStatement(stmts)), [])
          );
        },

        // x = rhs  -> __setVar("x", rhs, checkpointId)（内部名は除外）
        // obj.k = rhs -> __writeProp(...)
        // and always add an expression-level checkpoint around assignment.
        AssignmentExpression(path: any) {
          const { operator, left, right } = path.node;
          const checkpointId = checkpointAfterIdOf(path.node);

          if (t.isMemberExpression(left) && !left.optional) {
            const obj = left.object;
            const prop = left.computed ? left.property : t.stringLiteral(left.property.name);

            if (operator !== "=") {
              path.replaceWith(withCheckpointExpr(path.node, checkpointId));
              path.skip();
              return;
            }

            const replaced = t.callExpression(t.identifier("__writeProp"), [
              obj,
              prop,
              right,
              t.stringLiteral(checkpointId),
            ]);
            path.replaceWith(withCheckpointExpr(replaced, checkpointId));
            path.skip();
            return;
          }

          if (operator !== "=") {
            path.replaceWith(withCheckpointExpr(path.node, checkpointId));
            path.skip();
            return;
          }

          if (t.isIdentifier(left) && shouldRecordRoot(left.name)) {
            const replaced = t.callExpression(t.identifier("__setVar"), [
              t.stringLiteral(left.name),
              right,
              t.stringLiteral(checkpointId),
            ]);
            path.replaceWith(withCheckpointExpr(replaced, checkpointId));
            path.skip();
            return;
          }

          // Fallback: non-root identifiers / patterns are still checkpointed.
          path.replaceWith(withCheckpointExpr(path.node, checkpointId));
          path.skip();
        },

        // Method/function calls also get expression-level checkpoints.
        CallExpression(path: any) {
          const callee = path.node.callee;
          if (
            t.isIdentifier(callee) &&
            (callee.name === "__checkpoint" ||
              callee.name === "__setVar" ||
              callee.name === "__writeProp" ||
              callee.name === "__deleteProp" ||
              callee.name === "__deleteVar" ||
              callee.name === "__val" ||
              callee.name === "__callEnter" ||
              callee.name === "__callExit")
          ) {
            return;
          }
          if (t.isSuper(callee)) return;
          if (path.findParent((p: any) => isGen(p.node))) return;

          const checkpointId = checkpointAfterIdOf(path.node);
          path.replaceWith(withCheckpointExpr(path.node, checkpointId));
          path.skip();
        },

        // delete obj.k -> __deleteProp(...)
        UnaryExpression(path: any) {
          if (path.node.operator !== "delete") return;
          const arg = path.node.argument;
          if (t.isMemberExpression(arg) && !arg.optional) {
            const checkpointId = checkpointAfterIdOf(path.node);
            const obj = arg.object;
            const prop = arg.computed ? arg.property : t.stringLiteral(arg.property.name);
            path.replaceWith(
              t.callExpression(t.identifier("__deleteProp"), [
                obj,
                prop,
                t.stringLiteral(checkpointId),
              ])
            );
          }
        },

        // const x = init -> const x = __setVar("x", init, checkpointId)（内部名は除外）
        VariableDeclarator(path: any) {
          if (!t.isIdentifier(path.node.id)) return;
          if (!path.node.init) return;

          const name = path.node.id.name;
          if (!shouldRecordRoot(name)) return; // ★内部名はrootにしない

          const checkpointId = checkpointAfterIdOf(path.node);
          path.node.init = t.callExpression(t.identifier("__setVar"), [
            t.stringLiteral(name),
            path.node.init,
            t.stringLiteral(checkpointId),
          ]);
        },
        FunctionDeclaration(path: any) {
          const id = path.node.id;
          if (!id || !shouldRecordRoot(id.name)) return;
          if (!path.node.loc) return;
          path.insertAfter(mkRootSetStmt(id.name, checkpointStartIdOf(path.node)));
        },
        ClassDeclaration(path: any) {
          const id = path.node.id;
          if (!id || !shouldRecordRoot(id.name)) return;
          if (!path.node.loc) return;
          path.insertAfter(mkRootSetStmt(id.name, checkpointStartIdOf(path.node)));
        },

      },
    };
  };

  const out = Babel.transform(code, {
    ast: false,
    sourceType: "script",
    parserOpts: {
      plugins: [
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "optionalChaining",
        "nullishCoalescingOperator",
      ],
    },
    plugins: [instrumentPlugin],
    generatorOpts: { retainLines: true, compact: false, comments: true },
  });

  return out.code ?? code;
}
