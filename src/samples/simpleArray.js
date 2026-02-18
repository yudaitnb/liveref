const items = [1, 2, 3];
const box = { values: items };

items.push(4);
box.first = items[0];

console.log(box.values.length, box.first);
