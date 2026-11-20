export interface DeviceInfo {
  browserName: string;
  browserVersion: string | null;
  operatingSystem: string;
  userAgent: string;
}

export function parseDeviceInfo(userAgentHeader: string | string[] | undefined): DeviceInfo {
  const userAgent = (Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader ?? "未知浏览器").slice(0, 500);
  const browserMatchers: Array<[string, RegExp]> = [
    ["Microsoft Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/i],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/i],
    ["Firefox", /Firefox\/([\d.]+)/i],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/i],
    ["Safari", /Version\/([\d.]+).*Safari/i],
  ];
  let browserName = "其他浏览器";
  let browserVersion: string | null = null;
  for (const [name, matcher] of browserMatchers) {
    const match = userAgent.match(matcher);
    if (match) {
      browserName = name;
      browserVersion = match[1] ?? null;
      break;
    }
  }

  let operatingSystem = "其他系统";
  if (/Windows NT/i.test(userAgent)) operatingSystem = "Windows";
  else if (/Android/i.test(userAgent)) operatingSystem = "Android";
  else if (/(iPhone|iPad|iPod)/i.test(userAgent)) operatingSystem = "iOS";
  else if (/(Macintosh|Mac OS X)/i.test(userAgent)) operatingSystem = "macOS";
  else if (/Linux/i.test(userAgent)) operatingSystem = "Linux";

  return { browserName, browserVersion, operatingSystem, userAgent };
}
