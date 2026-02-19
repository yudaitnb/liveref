const queue = [];
const map = { first: null };
queue.push({ id: 1 });
queue.push({ id: 2 });
map.first = queue[0];
queue[1].next = map.first;
console.log(queue.length, map.first.id);
