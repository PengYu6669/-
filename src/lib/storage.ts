/**
 * 火山引擎 TOS 对象存储适配器
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

/** 上传文件到 TOS，返回完整 key */
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

/** 生成带 inline 头的预签名 URL（用于 <img>/<iframe> 直接渲染） */
export async function getSignedUrl(key: string, expiresInSec = 86400): Promise<string> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  const url = await client.getPreSignedUrl({
    bucket: BUCKET,
    key: fullKey,
    expires: expiresInSec,
    method: "GET",
    query: { "response-content-disposition": "inline" },
  } as any);
  return url;
}

/** 从 TOS 下载文件 */
export async function downloadFromTOS(key: string): Promise<Buffer> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  try {
    const res = await client.getObject({
      bucket: BUCKET,
      key: fullKey,
    });
    // TOS SDK v2: res.content 是 ReadableStream
    const stream = (res as any).content || (res as any).data;
    if (Buffer.isBuffer(stream)) return stream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  } catch (err: any) {
    console.error("❌ downloadFromTOS failed:", fullKey, err.message || err);
    throw err;
  }
}
