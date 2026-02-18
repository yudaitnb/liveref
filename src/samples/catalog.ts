import hello from "./hello.js?raw";
import simpleObject from "./simpleObject.js?raw";
import simpleArray from "./simpleArray.js?raw";
import doublyLinkedList from "./doublyLinkedList.js?raw";
import avl from "./AVL.js?raw";

export type SampleProgram = {
  id: string;
  name: string;
  level: "simple" | "complex";
  description: string;
  code: string;
};

export const samplePrograms: SampleProgram[] = [
  {
    id: "hello",
    name: "Hello Message",
    level: "simple",
    description: "A minimal variable + console.log example.",
    code: hello,
  },
  {
    id: "simple-object",
    name: "Simple Object References",
    level: "simple",
    description: "Object property writes and nested references.",
    code: simpleObject,
  },
  {
    id: "simple-array",
    name: "Simple Array References",
    level: "simple",
    description: "Array mutation and object-to-array references.",
    code: simpleArray,
  },
  {
    id: "doubly-linked-list",
    name: "Doubly Linked List",
    level: "complex",
    description: "Node insertion/removal with prev/next pointer updates.",
    code: doublyLinkedList,
  },
  {
    id: "avl",
    name: "AVL Tree",
    level: "complex",
    description: "Self-balancing tree sample (AVL).",
    code: avl,
  },
];

export const defaultSample = samplePrograms[3];
