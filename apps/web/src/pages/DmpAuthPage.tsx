import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Popconfirm, Space, Tag, Typography, message } from "antd";
import { CheckCircleOutlined, CopyOutlined, DeleteOutlined, KeyOutlined, ReloadOutlined, SafetyCertificateOutlined, DisconnectOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { api, errorMessage } from "../api";
import { DmpTasksPanel } from "./DmpTasksPanel";

interface DmpCredentialStatus {
  configured: boolean;
  encryptionReady: boolean;
  lastStatus: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  extensionPaired: boolean;
  extensionStatus: string;
  extensionLastSeenAt: string | null;
  extensionLastSyncAt: string | null;
  extensionTokenExpiresAt: string | null;
  extensionLastError: string | null;
}

interface PairingCode {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export function DmpAuthPage() {
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const statusQuery = useQuery({
    queryKey: ["dmpCredentials"],
    queryFn: async () => (await api.get<DmpCredentialStatus>("/dmp/credentials")).data,
    refetchInterval: 10000,
  });
  const status = statusQuery.data;

  async function generatePairingCode() {
    setPairing(true);
    try {
      const result = (await api.post<PairingCode>("/dmp/extension/pairing")).data;
      setPairingCode(result);
      message.success("配对码已生成，有效期5分钟。");
    } catch (error) { message.error(errorMessage(error)); }
    finally { setPairing(false); }
  }

  async function copyPairingCode() {
    if (!pairingCode?.code) return;
    try {
      await navigator.clipboard.writeText(pairingCode.code);
      message.success("配对码已复制。");
    } catch {
      message.info("请手动选中配对码复制；这不是 Cookie，只是一次性绑定码。");
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = (await api.post<{ ok: boolean; models: Array<{ name: string; model: string }> }>("/dmp/credentials/test")).data;
      await queryClient.invalidateQueries({ queryKey: ["dmpCredentials"] });
      message.success(`后端达摩盘连接成功，可用模型：${result.models.map((item) => item.name).join("、") || "已验证"}`);
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: ["dmpCredentials"] });
      message.error(errorMessage(error));
    } finally { setTesting(false); }
  }

  async function revokeExtension() {
    setRevoking(true);
    try {
      await api.post("/dmp/extension/revoke");
      setPairingCode(null);
      await queryClient.invalidateQueries({ queryKey: ["dmpCredentials"] });
      message.success("浏览器扩展已解绑。");
    } catch (error) { message.error(errorMessage(error)); }
    finally { setRevoking(false); }
  }

  async function removeCredentials() {
    setRemoving(true);
    try {
      await api.delete("/dmp/credentials");
      await queryClient.invalidateQueries({ queryKey: ["dmpCredentials"] });
      message.success("当前账号保存的达摩盘凭证已删除。扩展仍保持绑定，下一次登录会自动同步。");
    } catch (error) { message.error(errorMessage(error)); }
    finally { setRemoving(false); }
  }

  const statusLabel: Record<string, string> = { NOT_CONFIGURED: "等待首次同步", NOT_TESTED: "待验证", VALID: "连接正常", INVALID: "登录态失效", ERROR: "连接异常" };
  const statusColor = status?.lastStatus === "VALID" ? "success" : status?.lastStatus === "INVALID" || status?.lastStatus === "ERROR" ? "error" : "default";
  const extensionLabel: Record<string, string> = { NOT_PAIRED: "尚未绑定", TOKEN_EXPIRED: "扩展授权过期", PAIRING: "等待配对", WAITING_FOR_LOGIN: "等待达摩盘登录", VALID: "已连接", INVALID: "需要重新登录", ERROR: "同步异常" };
  const extensionColor = status?.extensionStatus === "VALID" ? "success" : status?.extensionStatus === "INVALID" || status?.extensionStatus === "ERROR" || status?.extensionStatus === "TOKEN_EXPIRED" ? "error" : "default";

  return (
    <div className="page-stack dmp-auth-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow">DMP AUTHORIZATION</div>
          <Typography.Title level={2}>达摩盘授权与后台任务</Typography.Title>
          <Typography.Text type="secondary">管理员统一维护达摩盘登录态，并管理商品数据获取任务；成员无需接触授权和采集流程。</Typography.Text>
        </div>
        <Tag color={statusColor}>{statusLabel[status?.lastStatus ?? "NOT_CONFIGURED"] ?? status?.lastStatus}</Tag>
      </div>

      {!status?.encryptionReady && <Alert type="error" showIcon message="服务端尚未配置凭证加密密钥" description="请在选品工具服务器环境变量中设置 DMP_CREDENTIAL_ENCRYPTION_KEY（64位十六进制密钥）。" />}

      <Card bordered={false} className="table-card">
        <div className="section-heading">
          <div>
            <Typography.Title level={4}>浏览器扩展连接</Typography.Title>
            <Typography.Text type="secondary">由管理员账号统一绑定；扩展只保存专用令牌，不保存 Cookie 明文。</Typography.Text>
          </div>
          <Tag color={extensionColor}>{extensionLabel[status?.extensionStatus ?? "NOT_PAIRED"] ?? status?.extensionStatus}</Tag>
        </div>
        <Space wrap size={[8, 8]}>
          <Tag color={status?.extensionPaired ? "success" : "default"}>{status?.extensionPaired ? "扩展已配对" : "扩展未配对"}</Tag>
          <Tag color={status?.configured ? "blue" : "default"}>{status?.configured ? "登录凭证已自动同步" : "等待首次同步"}</Tag>
          {status?.extensionLastSyncAt && <Typography.Text type="secondary">最近同步：{dayjs(status.extensionLastSyncAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>}
          {status?.extensionLastSeenAt && <Typography.Text type="secondary">扩展在线：{dayjs(status.extensionLastSeenAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>}
        </Space>

        {!status?.extensionPaired ? (
          <div className="dmp-extension-pair">
            <Alert
              type="info"
              showIcon
              message="首次使用只需绑定一次"
              description={<ol className="dmp-auth-steps"><li>打开 Chrome / EGO 浏览器的扩展管理页（<Typography.Text code>chrome://extensions</Typography.Text>），开启「开发者模式」。</li><li>点击「加载已解压的扩展程序」，选择 <Typography.Text code>F:\选品工具\apps\browser-extension</Typography.Text> 文件夹。</li><li>回到当前页面，生成下面的12位配对码；点击浏览器工具栏的「达摩盘登录助手」图标，输入配对码完成绑定。</li><li>在扩展弹窗中点击「打开达摩盘并自动同步」，正常登录达摩盘即可。</li></ol>}
            />
            <Space wrap align="center" className="dmp-pair-actions">
              <Button type="primary" icon={<KeyOutlined />} loading={pairing} disabled={!status?.encryptionReady} onClick={() => void generatePairingCode()}>生成一次性配对码</Button>
              {pairingCode && <Button icon={<CopyOutlined />} onClick={() => void copyPairingCode()}>复制配对码</Button>}
            </Space>
            {pairingCode && (
              <div className="dmp-pair-code">
                <Typography.Text type="secondary">配对码（5分钟内有效）</Typography.Text>
                <Typography.Title level={2} copyable={{ text: pairingCode.code }} className="dmp-pair-code-value">{pairingCode.code}</Typography.Title>
                <Typography.Text type="secondary">过期时间：{dayjs(pairingCode.expiresAt).format("HH:mm:ss")}</Typography.Text>
              </div>
            )}
          </div>
        ) : (
          <div className="dmp-extension-paired">
            <Alert
              type={status?.lastStatus === "INVALID" ? "warning" : status?.lastStatus === "VALID" ? "success" : "info"}
              showIcon
              message={status?.lastStatus === "INVALID" ? "达摩盘登录已失效" : status?.configured ? "达摩盘登录态已自动同步" : "扩展已绑定，等待首次登录"}
              description={status?.lastStatus === "INVALID" ? "请在扩展弹窗中打开达摩盘并重新登录。登录成功后，Cookie 会自动更新。" : "只要浏览器扩展保持启用，访问达摩盘时就会自动更新登录态。"}
            />
            <Space wrap className="dmp-pair-actions">
              <Button icon={<ReloadOutlined />} onClick={() => void statusQuery.refetch()} loading={statusQuery.isFetching}>刷新状态</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} disabled={!status?.configured} loading={testing} onClick={() => void testConnection()}>测试后端调用</Button>
              <Popconfirm title="确定解绑浏览器扩展？" description="解绑后扩展将不能再更新当前账号的达摩盘登录态。" onConfirm={() => void revokeExtension()}>
                <Button danger icon={<DisconnectOutlined />} loading={revoking}>解绑扩展</Button>
              </Popconfirm>
              <Popconfirm title="确定删除已保存的达摩盘凭证？" description="扩展仍会保持绑定，下一次达摩盘登录请求成功后会自动重新同步。" onConfirm={() => void removeCredentials()}>
                <Button danger ghost icon={<DeleteOutlined />} disabled={!status?.configured} loading={removing}>删除凭证</Button>
              </Popconfirm>
            </Space>
          </div>
        )}
        {status?.lastError && <Alert className="dmp-auth-error" type="warning" showIcon message={status.lastError} />}
        {status?.extensionLastError && <Alert className="dmp-auth-error" type="warning" showIcon message={status.extensionLastError} />}
        {status?.extensionTokenExpiresAt && <Typography.Text type="secondary">扩展授权有效期至：{dayjs(status.extensionTokenExpiresAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>}
      </Card>

      <Card bordered={false} className="table-card">
        <div className="section-heading"><div><Typography.Title level={4}>自动同步与过期提醒</Typography.Title><Typography.Text type="secondary">无需打开开发者工具，也无需复制 Cookie。</Typography.Text></div><SafetyCertificateOutlined style={{ color: "#315efb", fontSize: 22 }} /></div>
        <ol className="dmp-auth-steps">
          <li>扩展监听达摩盘 AI 模型列表请求，成功后自动读取当前域名适用的 Cookie（包括 HttpOnly）。</li>
          <li>Cookie 仅在扩展后台短暂处理，通过 HTTPS 发送到选品工具，服务端使用 AES-256-GCM 加密保存。</li>
          <li>扩展每15分钟检查一次授权状态；发现达摩盘返回401/403或登录重定向时，会发送系统通知。</li>
          <li>重新登录达摩盘后，下一次模型列表请求会触发自动同步，状态恢复后即可继续使用 AI 管家。</li>
          <li>注意：AI 管家实际请求仍由选品工具服务器发出；如果达摩盘限制服务器出口 IP，浏览器登录正常也可能无法调用，需要另外处理服务器网络限制。</li>
        </ol>
      </Card>
      <DmpTasksPanel />
      <Alert
        type="warning"
        showIcon
        message="权限与安全"
        description="扩展只读取 dmp.taobao.com 与 dmp.advgateway.taobao.com 适用的 Cookie，并只监听 dmp.taobao.com 的 model/list 请求；访问选品工具站点时仅申请当前配对域名权限。配对和同步只允许管理员绑定的扩展令牌，普通成员无权读取或操作授权信息。Cookie 不写入扩展存储、不显示在页面、不写入日志；扩展绑定令牌仅保存在浏览器扩展本地存储中，可随时解绑。生产环境必须使用 HTTPS。"
      />
    </div>
  );
}
