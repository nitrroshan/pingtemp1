/**
 * Helper function to get icon based on role name
 */
export const getIconForRole = (roleName: string): string => {
  const role = roleName.toLowerCase();
  if (role.includes("research") || role.includes("analyst")) return "Search";
  if (role.includes("write") || role.includes("content")) return "FileText";
  if (role.includes("review") || role.includes("quality")) return "CheckCircle";
  if (role.includes("code") || role.includes("dev")) return "Code";
  if (role.includes("design")) return "Palette";
  if (role.includes("test")) return "TestTube";
  if (role.includes("data")) return "Database";
  if (role.includes("plan") || role.includes("manage")) return "Calendar";
  return "Bot"; // Default icon
};
