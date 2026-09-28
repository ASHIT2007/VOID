/** Development fixtures shared with regression tests; no provider calls required. */
export const dsaFlowchart = 'flowchart TB\n' + [
  '  A["`**Pick a language**\nPython, C++ or Java`"] --> B["`**Time and space complexity**\nBig-O basics`"]',
  '  B --> C["`**Arrays and strings**\nTwo pointers, sliding window`"]',
  '  C --> D["`**Linked lists, stacks, queues**\nPointers, LIFO, FIFO`"]',
  '  D --> E["`**Recursion, searching, sorting**\nBinary search, merge sort`"]',
  '  E --> F["`**Hash maps and trees**\nBST, heaps, tries`"]',
  '  F --> G["`**Graphs**\nBFS, DFS, shortest paths`"]',
  '  G --> H["`**Dynamic programming**\nMemoization, tabulation`"]',
  '  H --> I["`**Practice and mock interviews**\nRevisit weak topics`"]',
  '  classDef foundations fill:#41413e,stroke:#777770,color:#f5f5f5',
  '  classDef structures fill:#493886,stroke:#8270bc,color:#f5f5f5',
  '  classDef algorithms fill:#17654e,stroke:#37997b,color:#f5f5f5',
  '  class A,B,I foundations',
  '  class C,D,F structures',
  '  class E,G,H algorithms',
].join('\n');

export const weekendFlowchart = `flowchart TB
  A([Wake up]) --> B{Is it raining?}
  B -->|Yes| C[Watch a movie]
  B -->|No| D[Go for a walk]
  D --> E{Found a café?}
  E -->|Yes| F[Read a book]
  E -->|No| G[Order pizza]
  C --> F
  F --> H([Nap])
  G --> H`;

export const weekendMindmap = `mindmap
  root((Weekend))
    Food
      Coffee
      Sweet snacks
      Pizza
    Outdoors
      Walk
      Picnic
      Cycling
    Friends
      Board games
      Cricket
      Video calls
    Chill
      Movies
      Reading
      Nap`;
