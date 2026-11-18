import net from 'node:net';
import { config } from '../config.js';

const blockList = new net.BlockList();
for (const cidr of config.internalNetworks) {
  const [addr, bits] = cidr.split('/');
  const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
  try {
    if (bits) blockList.addSubnet(addr, Number(bits), type);
    else blockList.addAddress(addr, type);
  } catch {
    console.warn(`[réseau] INTERNAL_NETWORKS : entrée ignorée « ${cidr} »`);
  }
}

/** Adresse IP du client (tient compte du proxy nginx si TRUST_PROXY=true). */
export function clientIp(req) {
  let ip = req.ip || req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

export function isInternal(ip) {
  if (!ip) return false;
  if (ip === '::1') return true;
  const type = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
  try {
    return blockList.check(ip, type);
  } catch {
    return false;
  }
}

export function originLabel(req) {
  return isInternal(clientIp(req)) ? 'Réseau interne' : 'Internet';
}
