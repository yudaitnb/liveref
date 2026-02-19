import simpleObject from "./simpleObject.js?raw";
import simpleArray from "./simpleArray.js?raw";
import variablesMany from "./variablesMany.js?raw";
import assignmentsMany from "./assignmentsMany.js?raw";
import functionCallsMany from "./functionCallsMany.js?raw";
import dataStructures from "./dataStructures.js?raw";
import conditionsIfElse from "./conditionsIfElse.js?raw";
import forLoopSum from "./forLoopSum.js?raw";
import arrayMutationChain from "./arrayMutationChain.js?raw";
import deleteProperties from "./deleteProperties.js?raw";
import doublyLinkedList from "./doublyLinkedList.js?raw";
import avl from "./AVL.js?raw";

export type SampleProgram = {
  id: string;
  name: string;
  category: string;
  level: "simple" | "complex";
  description: string;
  code: string;
};

export const samplePrograms: SampleProgram[] = [
  {
    id: "simple-object",
    name: "Simple Object References",
    category: "Object",
    level: "simple",
    description: "Object property writes and nested references.",
    code: simpleObject,
  },
  {
    id: "simple-array",
    name: "Simple Array References",
    category: "Array",
    level: "simple",
    description: "Array mutation and object-to-array references.",
    code: simpleArray,
  },
  {
    id: "variables-many",
    name: "Variable Declarations",
    category: "Variables",
    level: "simple",
    description: "const/let/var declarations and root updates.",
    code: variablesMany,
  },
  {
    id: "assignments-many",
    name: "Assignments",
    category: "Assignment",
    level: "simple",
    description: "Repeated reassignment into variables and object fields.",
    code: assignmentsMany,
  },
  {
    id: "function-calls-many",
    name: "Function Calls",
    category: "Function",
    level: "simple",
    description: "Multiple function calls chained through one value.",
    code: functionCallsMany,
  },
  {
    id: "data-structures",
    name: "Data Structures",
    category: "Data",
    level: "simple",
    description: "Array + object references with cross-links.",
    code: dataStructures,
  },
  {
    id: "conditions-if-else",
    name: "If / Else",
    category: "Control Flow",
    level: "simple",
    description: "Branch-driven property writes.",
    code: conditionsIfElse,
  },
  {
    id: "for-loop-sum",
    name: "For Loop",
    category: "Loop",
    level: "simple",
    description: "Simple indexed loop and accumulator update.",
    code: forLoopSum,
  },
  {
    id: "array-mutation-chain",
    name: "Array Mutation Chain",
    category: "Array",
    level: "simple",
    description: "Index updates, push, and node-to-node references.",
    code: arrayMutationChain,
  },
  {
    id: "delete-properties",
    name: "Delete Properties",
    category: "Delete",
    level: "simple",
    description: "Property creation and delete operations.",
    code: deleteProperties,
  },
  {
    id: "doubly-linked-list",
    name: "Doubly Linked List",
    category: "Linked List",
    level: "complex",
    description: "Node insertion/removal with prev/next pointer updates.",
    code: doublyLinkedList,
  },
  {
    id: "avl",
    name: "AVL Tree",
    category: "Tree",
    level: "complex",
    description: "Self-balancing tree sample (AVL).",
    code: avl,
  },
];

export const defaultSample =
  samplePrograms.find((sample) => sample.id === "avl") ?? samplePrograms[0];
