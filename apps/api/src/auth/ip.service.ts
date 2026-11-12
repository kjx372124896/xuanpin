import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import * as ipaddr from "ipaddr.js";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class IpService {
  constructor(private readonly prisma: PrismaService) {}

  async isAllowed(rawIp: string | undefined | null): Promise<boolean> {
    if (!rawIp) return false;
    let address: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      address = ipaddr.process(rawIp.replace(/^::ffff:/i, ""));
    } catch {
      return false;
    }
    const rules = await this.prisma.ipWhitelist.findMany({ where: { enabled: true }, select: { cidr: true } });
    return rules.some(({ cidr }) => {
      try {
        const [network, prefix] = ipaddr.parseCIDR(this.normalizeCidr(cidr));
        return address.kind() === network.kind() && address.match(network, prefix);
      } catch {
        return false;
      }
    });
  }

  async assertEmployeeIp(rawIp: string | undefined | null) {
    if (!(await this.isAllowed(rawIp))) {
      throw new ForbiddenException("当前网络 IP 不在允许范围内，请联系管理员配置白名单。");
    }
  }

  normalizeCidr(cidr: string) {
    try {
      if (cidr.includes("/")) {
        const [address, prefix] = ipaddr.parseCIDR(cidr.trim());
        return `${address.toString()}/${prefix}`;
      }
      const address = ipaddr.parse(cidr.trim());
      return `${address.toString()}/${address.kind() === "ipv4" ? 32 : 128}`;
    } catch {
      throw new BadRequestException("IP 地址或 CIDR 网段格式不正确。");
    }
  }
}
