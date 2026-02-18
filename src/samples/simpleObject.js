const user = { name: "Ada" };
const meta = { active: true };

user.meta = meta;
meta.score = 42;

console.log(user.name, user.meta.score);
