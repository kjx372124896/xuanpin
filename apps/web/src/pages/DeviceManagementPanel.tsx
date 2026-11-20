import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Input, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { api, errorMessage } from "../api";

interface DeviceRequestRow {
  id: string;
  userId: string;
  username: string;
  userName: string;
  role: string;
  browserName: string;
  browserVersion: string | null;
  operatingSystem: string;
  requestIp: string | null;
  requestedAt: string;
  currentDevice: { browserName: string; browserVersion: string | null; operatingSystem: string; lastSeenAt: string; lastLoginIp: string | null } | null;
}

interface DeviceRow {
  id: string;
  userId: string;
  username: string;
  userName: string;
  role: string;
  accountStatus: string;
  employmentStatus: string;
  browserName: string;
  browserVersion: string | null;
  operatingSystem: string;
  firstBoundAt: string;
  lastSeenAt: string;
  lastLoginIp: string | null;
}

interface DeviceAuditRow {
  id: string;
  action: string;
  targetUser: { username: string; name: string };
  actor: { username: string; name: string } | null;
  ip: string | null;
  createdAt: string;
}

const roleLabels: Record<string, string> = { SUPER_ADMIN: "超级管理员", ADMIN: "管理员", EMPLOYEE: "普通员工" };
const actionLabels: Record<string, string> = {
  FIRST_BIND: "首次绑定",
  CHANGE_REQUEST: "申请更换设备",
  APPROVE_CHANGE: "审批通过",
  REJECT_CHANGE: "拒绝申请",
  ADMIN_UNBIND: "管理员解除绑定",
  SERVER_RECOVERY_RESET: "服务器紧急重置",
};

export function DeviceManagementPanel() {
  const queryClient = useQueryClient();
  const [reviewTarget, setReviewTarget] = useState<{ row: DeviceRequestRow; action: "approve" | "reject" } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const requestsQuery = useQuery({ queryKey: ["adminDeviceRequests"], queryFn: async () => (await api.get<DeviceRequestRow[]>("/admin/device-requests")).data });
  const devicesQuery = useQuery({ queryKey: ["adminDevices"], queryFn: async () => (await api.get<DeviceRow[]>("/admin/devices")).data });
  const logsQuery = useQuery({ queryKey: ["adminDeviceAuditLogs"], queryFn: async () => (await api.get<DeviceAuditRow[]>("/admin/device-audit-logs")).data });

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ["adminDeviceRequests"] });
    void queryClient.invalidateQueries({ queryKey: ["adminDevices"] });
    void queryClient.invalidateQueries({ queryKey: ["adminDeviceAuditLogs"] });
  }

  async function submitReview() {
    if (!reviewTarget) return;
    setReviewBusy(true);
    try {
      await api.patch(`/admin/device-requests/${reviewTarget.row.id}/${reviewTarget.action}`, { note: reviewNote.trim() || undefined });
      message.success(reviewTarget.action === "approve" ? "已通过设备更换申请，新设备现已生效" : "已拒绝设备更换申请");
      setReviewTarget(null);
      setReviewNote("");
      refreshAll();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setReviewBusy(false);
    }
  }

  async function unbind(row: DeviceRow) {
    try {
      await api.delete(`/admin/devices/${row.userId}`);
      message.success(`已解除 ${row.userName} 的设备绑定，原登录会话已失效`);
      refreshAll();
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  const requestColumns: ColumnsType<DeviceRequestRow> = [
    { title: "申请员工", key: "employee", width: 150, render: (_value, row) => <div><div className="admin-user-name">{row.userName}</div><Typography.Text type="secondary">{row.username} · {roleLabels[row.role] ?? row.role}</Typography.Text></div> },
    { title: "申请绑定的新设备", key: "newDevice", width: 190, render: (_value, row) => <div><div>{row.browserName}{row.browserVersion ? ` ${row.browserVersion}` : ""}</div><Typography.Text type="secondary">{row.operatingSystem}</Typography.Text></div> },
    { title: "当前绑定设备", key: "currentDevice", width: 190, render: (_value, row) => row.currentDevice ? <div><div>{row.currentDevice.browserName}{row.currentDevice.browserVersion ? ` ${row.currentDevice.browserVersion}` : ""}</div><Typography.Text type="secondary">{row.currentDevice.operatingSystem}</Typography.Text></div> : <Tag>暂无绑定</Tag> },
    { title: "申请 IP", dataIndex: "requestIp", key: "ip", width: 135, render: (value) => value || "—" },
    { title: "申请时间", dataIndex: "requestedAt", key: "requestedAt", width: 155, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    { title: "操作", key: "actions", fixed: "right", width: 150, render: (_value, row) => <Space size={4}><Button size="small" type="primary" onClick={() => { setReviewTarget({ row, action: "approve" }); setReviewNote(""); }}>通过</Button><Button size="small" danger onClick={() => { setReviewTarget({ row, action: "reject" }); setReviewNote(""); }}>拒绝</Button></Space> },
  ];

  const deviceColumns: ColumnsType<DeviceRow> = [
    { title: "员工", key: "employee", width: 160, render: (_value, row) => <div><div className="admin-user-name">{row.userName}</div><Typography.Text type="secondary">{row.username}</Typography.Text></div> },
    { title: "角色", dataIndex: "role", key: "role", width: 110, render: (value) => <Tag color={value === "SUPER_ADMIN" ? "purple" : value === "ADMIN" ? "blue" : "default"}>{roleLabels[value] ?? value}</Tag> },
    { title: "已绑定设备", key: "device", width: 190, render: (_value, row) => <div><div>{row.browserName}{row.browserVersion ? ` ${row.browserVersion}` : ""}</div><Typography.Text type="secondary">{row.operatingSystem}</Typography.Text></div> },
    { title: "首次绑定", dataIndex: "firstBoundAt", key: "firstBoundAt", width: 155, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    { title: "最近登录", dataIndex: "lastSeenAt", key: "lastSeenAt", width: 155, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    { title: "最近登录 IP", dataIndex: "lastLoginIp", key: "lastLoginIp", width: 135, render: (value) => value || "—" },
    { title: "操作", key: "action", fixed: "right", width: 110, render: (_value, row) => <Popconfirm title={`确定解除 ${row.userName} 的设备绑定？`} description="解除后该账号所有登录会话立即失效，下次登录会重新绑定当前浏览器。" okText="解除绑定" cancelText="取消" onConfirm={() => void unbind(row)}><Button danger size="small">解除绑定</Button></Popconfirm> },
  ];

  const logColumns: ColumnsType<DeviceAuditRow> = [
    { title: "目标员工", key: "target", width: 160, render: (_value, row) => <div><div>{row.targetUser.name}</div><Typography.Text type="secondary">{row.targetUser.username}</Typography.Text></div> },
    { title: "操作", dataIndex: "action", key: "action", width: 145, render: (value) => actionLabels[value] ?? value },
    { title: "操作管理员", key: "actor", width: 160, render: (_value, row) => row.actor ? `${row.actor.name}（${row.actor.username}）` : "系统" },
    { title: "操作 IP", dataIndex: "ip", key: "ip", width: 135, render: (value) => value || "—" },
    { title: "时间", dataIndex: "createdAt", key: "createdAt", width: 155, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm:ss") },
  ];

  return (
    <div className="page-stack">
      <div className="admin-note"><Typography.Text>每个账号仅允许绑定一个浏览器。首次登录自动绑定；更换电脑或浏览器必须审批。审批通过后，旧设备的登录会话立即失效。IP 仅作记录，不再限制登录。</Typography.Text></div>
      <Tabs items={[
        { key: "requests", label: <span>待审批申请 <Tag color={requestsQuery.data?.length ? "warning" : "default"}>{requestsQuery.data?.length ?? 0}</Tag></span>, children: <Card bordered={false} className="table-card"><div className="table-heading"><div><Typography.Title level={4}>设备更换申请</Typography.Title><Typography.Text type="secondary">申请提交后 24 小时内有效，审批通过后新设备替换旧设备。</Typography.Text></div><Button onClick={() => void requestsQuery.refetch()} loading={requestsQuery.isFetching}>刷新</Button></div><Table<DeviceRequestRow> rowKey="id" loading={requestsQuery.isLoading} columns={requestColumns} dataSource={requestsQuery.data ?? []} scroll={{ x: 1050 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: "暂无待审批的设备更换申请" }} /></Card> },
        { key: "devices", label: "已绑定设备", children: <Card bordered={false} className="table-card"><div className="table-heading"><div><Typography.Title level={4}>员工设备绑定</Typography.Title><Typography.Text type="secondary">管理员和普通员工账号均纳入设备绑定管理。</Typography.Text></div><Button onClick={() => void devicesQuery.refetch()} loading={devicesQuery.isFetching}>刷新</Button></div><Table<DeviceRow> rowKey="id" loading={devicesQuery.isLoading} columns={deviceColumns} dataSource={devicesQuery.data ?? []} scroll={{ x: 1050 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: "暂无已绑定设备；员工首次登录后会自动登记" }} /></Card> },
        { key: "logs", label: "操作记录", children: <Card bordered={false} className="table-card"><div className="table-heading"><div><Typography.Title level={4}>设备操作记录</Typography.Title><Typography.Text type="secondary">展示最近 100 条首次绑定、申请、审批和解绑记录。</Typography.Text></div><Button onClick={() => void logsQuery.refetch()} loading={logsQuery.isFetching}>刷新</Button></div><Table<DeviceAuditRow> rowKey="id" loading={logsQuery.isLoading} columns={logColumns} dataSource={logsQuery.data ?? []} scroll={{ x: 750 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: "暂无设备操作记录" }} /></Card> },
      ]} />
      <Modal
        title={reviewTarget?.action === "approve" ? "审批通过设备更换" : "拒绝设备更换申请"}
        open={Boolean(reviewTarget)}
        onCancel={() => setReviewTarget(null)}
        onOk={() => void submitReview()}
        confirmLoading={reviewBusy}
        okText={reviewTarget?.action === "approve" ? "确认通过" : "确认拒绝"}
        cancelText="取消"
      >
        {reviewTarget && <div className="page-stack"><Typography.Text>员工：{reviewTarget.row.userName}（{reviewTarget.row.username}）</Typography.Text><Typography.Text>新设备：{reviewTarget.row.browserName} · {reviewTarget.row.operatingSystem}</Typography.Text><Input.TextArea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={500} rows={3} placeholder="审批备注（选填）" /></div>}
      </Modal>
    </div>
  );
}
