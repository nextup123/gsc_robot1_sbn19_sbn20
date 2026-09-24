export function parseUptime(uptimeString) {
  const timeMatch = uptimeString.match(/^(\d{2}:\d{2}:\d{2})/);
  const upMatch = uptimeString.match(/up\s+(.+?),/);
  const loadMatch = uptimeString.match(/load average:\s+(.+)$/);

  return {
    currentTime: timeMatch ? timeMatch[1] : "N/A",
    uptime: upMatch ? upMatch[1] : "N/A",
    loadAverage: loadMatch ? loadMatch[1] : "N/A",
  };
}

export function isValidServiceName(name) {
  return /^[a-zA-Z0-9-_]+$/.test(name);
}
