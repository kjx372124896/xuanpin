import { useEffect, useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { CopyOutlined, DatabaseOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, errorMessage } from "../api";

export function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    api.get<{ ip: string | null }>("/auth/client-ip", { signal: controller.signal })
      .then(({ data }) => setClientIp(data.ip))
      .catch(() => { if (!controller.signal.aborted) setClientIp(null); })
      .finally(() => { if (!controller.signal.aborted) setIpLoading(false); });
    return () => controller.abort();
  }, []);

  async function copyClientIp() {
    if (!clientIp) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(clientIp);
      message.success("IP 已复制，请发送给管理员添加白名单。");
    } catch {
      message.error("复制失败，请手动选中 IP 复制。");
    }
  }

  async function submit(values: { username: string; password: string }) {
    setBusy(true);
    try {
      await login(values.username, values.password);
      navigate("/", { replace: true });
    } catch (error) {
      message.error(errorMessage(error));
    } finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-decoration login-decoration-one" /><div className="login-decoration login-decoration-two" />
      <div className="login-left">
        <div className="login-brand"><div className="brand-icon"><DatabaseOutlined /></div><span>选品数据中心</span></div>
        <div className="login-copy"><div className="eyebrow">PRODUCT INTELLIGENCE</div><Typography.Title level={1}>让每一次选品，<br />都有数据依据。</Typography.Title><Typography.Paragraph>汇集类目商品榜单，追踪商品周度变化。把分散的数据，变成清晰的趋势与判断。</Typography.Paragraph>
          <div className="login-feature-list"><div><span>01</span> 多周期榜单统一管理</div><div><span>02</span> 商品历史趋势追踪</div><div><span>03</span> 团队内部协作使用</div></div>
        </div>
        <div className="login-footnote">INTERNAL BUSINESS TOOL · 仅限公司员工使用</div>
      </div>
      <div className="login-right">
        <Card className="login-card" bordered={false}>
          <div className="login-card-heading"><Typography.Title level={3}>欢迎回来</Typography.Title><Typography.Text type="secondary">登录账号以进入选品工作台</Typography.Text></div>
          <Form layout="vertical" size="large" onFinish={submit} requiredMark={false}>
            <Form.Item label="登录账号" name="username" rules={[{ required: true, message: "请输入登录账号" }]}><Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" /></Form.Item>
            <Form.Item label="登录密码" name="password" rules={[{ required: true, message: "请输入登录密码" }]}><Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" /></Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy} className="login-submit">登录工作台</Button>
          </Form>
          <div className="login-ip-panel">
            <div className="login-ip-main">
              <div className="login-ip-label">当前网络 IP</div>
              <Typography.Text className="login-ip-value">{ipLoading ? "正在获取…" : clientIp ?? "暂时无法获取"}</Typography.Text>
            </div>
            <Button size="small" icon={<CopyOutlined />} onClick={() => void copyClientIp()} disabled={!clientIp}>复制 IP</Button>
            <div className="login-ip-hint">如提示 IP 不在白名单，请复制此地址发送给管理员添加。</div>
          </div>
          <div className="login-card-foot">账号由系统管理员创建，如无法登录请联系管理员。</div>
        </Card>
      </div>
    </div>
  );
}
