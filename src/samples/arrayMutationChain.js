const items = [{ v: 1 }, { v: 2 }];
items[0].next = items[1];
items.push({ v: 3 });
items[2].prev = items[1];
items[1].v = 20;
console.log(items[2].prev.v);
