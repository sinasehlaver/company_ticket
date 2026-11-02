// Role display + cap helpers shared by the views. Built-in roles get translated labels (role_<key>); custom roles
// show the name the admin gave them (server sends roleName / name).
const BUILTIN = ["superuser", "baskan", "sales"];
export const roleLabel = (t, key, name) => (BUILTIN.includes(key) ? t(`role_${key}`) : name || key);
