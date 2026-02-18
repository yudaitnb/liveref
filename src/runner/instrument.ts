import * as Babel from "@babel/standalone";

const INTERNAL_NAME_RE = /^(?:__|_o|_a)/;

function shouldRecordRoot(name: string) {
  return !INTERNAL_NAME_RE.test(name);
}

function locIdOf(node: any): string {
  const line = node.loc?.start?.line ?? 1;     // Babel line は 1-based
  const col0 = node.loc?.start?.column ?? 0;   // Babel column は 0-based
  const col1 = col0 + 1;                       // Monaco 用に 1-basedへ
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

    const mkTrace = (locId: string) =>
      markGen(
        t.expressionStatement(
          t.callExpression(t.identifier("__trace"), [t.stringLiteral(locId)])
        )
      );

    const isTraceStmt = (stmt: any) =>
      t.isExpressionStatement(stmt) &&
      t.isCallExpression(stmt.expression) &&
      t.isIdentifier(stmt.expression.callee, { name: "__trace" });

    const shouldInstrumentStmt = (stmt: any) => {
      if (isTraceStmt(stmt)) return false;
      if (isGen(stmt)) return false;

      // ★内部生成stmtは loc が無いことが多いので、loc無しstmtにも trace を入れない
      if (!stmt.loc) return false;

      if (
        t.isEmptyStatement(stmt) ||
        t.isReturnStatement(stmt) ||
        t.isThrowStatement(stmt) ||
        t.isBreakStatement(stmt) ||
        t.isContinueStatement(stmt)
      )
        return false;

      return true;
    };

    const ensureBlock = (p: any, key: string) => {
      const sub = p.get(key);
      if (!sub || sub.isBlockStatement()) return;
      sub.replaceWith(t.blockStatement([sub.node]));
    };

    return {
      visitor: {
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

          const locId = locIdOf(path.node);
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
                      t.stringLiteral(locId),
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

          const locId = locIdOf(path.node);
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
                    t.stringLiteral(locId),
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

        // x = rhs  -> __setVar("x", rhs, locId)（内部名は除外）
        // obj.k = rhs -> __writeProp(...)
        AssignmentExpression(path: any) {
          const { operator, left, right } = path.node;
          if (operator !== "=") return;
          const locId = locIdOf(path.node);

          if (t.isMemberExpression(left) && !left.optional) {
            const obj = left.object;
            const prop = left.computed ? left.property : t.stringLiteral(left.property.name);

            path.replaceWith(
              t.callExpression(t.identifier("__writeProp"), [
                obj,
                prop,
                right,
                t.stringLiteral(locId),
              ])
            );
            return;
          }

          if (t.isIdentifier(left)) {
            if (!shouldRecordRoot(left.name)) return; // ★内部名はrootにしない
            path.replaceWith(
              t.callExpression(t.identifier("__setVar"), [
                t.stringLiteral(left.name),
                right,
                t.stringLiteral(locId),
              ])
            );
          }
        },

        // delete obj.k -> __deleteProp(...)
        UnaryExpression(path: any) {
          if (path.node.operator !== "delete") return;
          const arg = path.node.argument;
          if (t.isMemberExpression(arg) && !arg.optional) {
            const locId = locIdOf(path.node);
            const obj = arg.object;
            const prop = arg.computed ? arg.property : t.stringLiteral(arg.property.name);
            path.replaceWith(
              t.callExpression(t.identifier("__deleteProp"), [
                obj,
                prop,
                t.stringLiteral(locId),
              ])
            );
          }
        },

        // const x = init -> const x = __setVar("x", init, locId)（内部名は除外）
        VariableDeclarator(path: any) {
          if (!t.isIdentifier(path.node.id)) return;
          if (!path.node.init) return;

          const name = path.node.id.name;
          if (!shouldRecordRoot(name)) return; // ★内部名はrootにしない

          const locId = locIdOf(path.node);
          path.node.init = t.callExpression(t.identifier("__setVar"), [
            t.stringLiteral(name),
            path.node.init,
            t.stringLiteral(locId),
          ]);
        },

        // ★重要：trace の挿入は “変換後” にやる（exit）
        Program: {
          exit(path: any) {
            const body: any[] = [];
            for (const stmt of path.node.body) {
              body.push(stmt);
              if (shouldInstrumentStmt(stmt)) body.push(mkTrace(locIdOf(stmt)));
            }
            path.node.body = body;
          },
        },
        BlockStatement: {
          exit(path: any) {
            const body: any[] = [];
            for (const stmt of path.node.body) {
              body.push(stmt);
              if (shouldInstrumentStmt(stmt)) body.push(mkTrace(locIdOf(stmt)));
            }
            path.node.body = body;
          },
        },
      },
    };
  };

  const out = Babel.transform(code, {
    ast: false,
    sourceType: "script",
    plugins: [instrumentPlugin],
    generatorOpts: { retainLines: true, compact: false, comments: true },
  });

  return out.code ?? code;
}
