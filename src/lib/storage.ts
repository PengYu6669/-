/**
 * 火山引擎 TOS 对象存储适配器
 * 文件操作：上传 / 获取签名 URL
 */
import TOS from "@volcengine/tos-sdk";

const REGION = process.env.VOLC_TOS_REGION || "cn-beijing";
const BUCKET = process.env.VOLC_TOS_BUCKET || "";
const ENDPOINT = process.env.VOLC_TOS_ENDPOINT || "tos-cn-beijing.volces.com";
const PREFIX = process.env.VOLC_TOS_PREFIX || "ima-clone/files/";

const client = new TOS({
  region: REGION,
  endpoint: ENDPOINT,
  accessKeyId: process.env.VOLC_TOS_ACCESS_KEY || "",
  accessKeySecret: process.env.VOLC_TOS_SECRET_KEY || "",
  secure: process.env.VOLC_TOS_SECURE !== "false",
});

/** 上传文件到 TOS */
export async function uploadToTOS(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const fullKey = PREFIX + key;
  await client.putObject({
    bucket: BUCKET,
    key: fullKey,
    body: buffer,
    contentType,
  });
  return fullKey;
}

/** 生成预签名 URL（默认 1 小时有效） */
export async function getSignedUrl(key: string, expiresInSec = 3600): Promise<string> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  const url = await client.getPreSignedUrl({
    bucket: BUCKET,
    key: fullKey,
    expires: expiresInSec,
    method: "GET",
  });
  return url;
}

/** 从 TOS 下载文件内容 */
export async function downloadFromTOS(key: string): Promise<Buffer> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  const res = await client.getObject({
    bucket: BUCKET,
    key: fullKey,
  });
  // res.data 是 ReadableStream 或 Buffer
  if (Buffer.isBuffer(res.data)) return res.data;
  const chunks: Buffer[] = [];
  for await (const chunk of res.data as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
