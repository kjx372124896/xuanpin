import { useCallback, useEffect, useState } from "react";
import { Button, Card, Result, Spin, Tag, Typography } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "ERROR" | "LOADING";

interface DeviceRequestStatus {
  status: Exclude<RequestStatus, "ERROR" | "LOADING">;
  requestedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export function DeviceApprovalPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestId = searchParams.get("requestId");
  const [status, setStatus] = useState<RequestStatus>(requestId ? "LOADING" : "ERROR");
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    if (!requestId) return;
    setChecking(true);
    try {
      const { data } = await api.get<DeviceRequestStatus>(`/auth/device-requests/${encodeURIComponent(requestId)}/status`);
      setStatus(data.status);
      setReviewNote(data.reviewNote);
      setRequestedAt(data.requestedAt);
    } catch {
      setStatus("ERROR");
    } finally {
      setChecking(false);
    }
  }, [requestId]);

  useEffect(() => {
    if (status !== "LOADING" && status !== "PENDING") return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  const approved = status === "APPROVED";
  const rejected = status === "REJECTED";
  const expired = status === "EXPIRED";
  const pending = status === "PENDING" || status === "LOADING";

  return (
    <div className="device-approval-page">
      <Card className="device-approval-card" bordered={false}>
        <div className="device-approval-brand">选品数据中心</div>
        {pending && <Result
          icon={status === "LOADING" ? <Spin size="large" /> : <div className="device-approval-icon">⌛</div>}
          title="设备更换申请已提交"
          subTitle="当前浏览器尚未获得授权，管理员审批通过前无法进入选品工具。页面每 5 秒自动查询一次审批状态。"
          extra={<Tag color="warning">等待管理员审批</Tag>}
        />}
        {approved && <Result
          status="success"
          title="设备绑定审批已通过"
          subTitle="当前浏览器已经成为此账号的新绑定设备。请重新登录，原设备的登录会话已失效。"
          extra={<Button type="primary" onClick={() => navigate("/login", { replace: true })}>返回登录</Button>}
        />}
        {rejected && <Result
          status="error"
          title="设备更换申请未通过"
          subTitle={reviewNote || "管理员已拒绝本次设备更换申请。如确需更换，请联系管理员确认后重新申请。"}
          extra={<Button type="primary" onClick={() => navigate("/login", { replace: true })}>返回登录</Button>}
        />}
        {expired && <Result
          status="warning"
          title="设备申请已过期"
          subTitle="申请超过 24 小时未完成审批。请重新登录并提交新的设备更换申请。"
          extra={<Button type="primary" onClick={() => navigate("/login", { replace: true })}>重新登录</Button>}
        />}
        {status === "ERROR" && <Result
          status="error"
          title="暂时无法查询审批状态"
          subTitle="请确认当前浏览器未清除 Cookie，然后重试；如果仍无法查询，请重新登录或联系管理员。"
          extra={<Button type="primary" onClick={() => void refresh()} loading={checking}>重新查询</Button>}
        />}
        {requestedAt && <Typography.Text className="device-approval-time" type="secondary">申请时间：{new Date(requestedAt).toLocaleString()}</Typography.Text>}
        {pending && <div className="device-approval-actions"><Button onClick={() => void refresh()} loading={checking}>立即刷新状态</Button><Button type="link" onClick={() => navigate("/login", { replace: true })}>返回登录页</Button></div>}
      </Card>
    </div>
  );
}
