const session = { user: { name: "Ada" }, token: "abc" };
session.user.role = "admin";
delete session.token;
delete session.user.role;
console.log(session.user.name, session.token);
