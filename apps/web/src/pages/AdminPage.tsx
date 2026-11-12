import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, KeyOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useAuth } from "../auth/AuthContext";
import { api, errorMessage } from "../api";

interface UserRow { id: string; username: string; name: string; employeeNo: string | null; department: string | null; role: string; employmentStatus: string; accountStatus: string; canImport: boolean; createdAt: string }
interface IpRule { id: string; cidr: string; label: string; enabled: boolean; createdAt: string; updatedAt: string }

const roleLabel: Record<string, string> = { SUPER_ADMIN: "超级管理员", ADMIN: "管理员", EMPLOYEE: "普通员工" };
const employmentLabel: Record<string, string> = { ACTIVE: "在职", RESIGNED: "离职", SUSPENDED: "停用" };

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [userModal, setUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [ipModal, setIpModal] = useState(false);
  const [editingIp, setEditingIp] = useState<IpRule | null>(null);
  const [userForm] = Form.useForm();
  const [ipForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const usersQuery = useQuery({ queryKey: ["adminUsers"], queryFn: async () => (await api.get<UserRow[]>("/admin/users")).data });
  const ipsQuery = useQuery({ queryKey: ["adminIps"], queryFn: async () => (await api.get<IpRule[]>("/admin/ip-rules")).data });

  function refreshUsers() { void queryClient.invalidateQueries({ queryKey: ["adminUsers"] }); }
  function refreshIps() { void queryClient.invalidateQueries({ queryKey: ["adminIps"] }); }

  async function saveUser(values: Record<string, unknown>) {
    try {
      if (editingUser) await api.patch(`/admin/users/${editingUser.id}`, values);
      else await api.post("/admin/users", values);
      message.success(editingUser ? "员工账号已更新" : "员工账号已创建");
      setUserModal(false); setEditingUser(null); userForm.resetFields(); refreshUsers();
    } catch (error) { message.error(errorMessage(error)); }
  }

  function openCreateUser() { setEditingUser(null); userForm.resetFields(); userForm.setFieldsValue({ role: "EMPLOYEE", canImport: false }); setUserModal(true); }
  function openEditUser(row: UserRow) {
    setEditingUser(row);
    const values: Record<string, unknown> = { name: row.name, department: row.department, employmentStatus: row.employmentStatus, accountStatus: row.accountStatus, canImport: row.canImport };
    if (isSuperAdmin) values.role = row.role;
    userForm.setFieldsValue(values);
    setUserModal(true);
  }

  async function resetPassword(values: { password: string }) {
    if (!resetUser) return;
    try { await api.post(`/admin/users/${resetUser.id}/reset-password`, values); message.success("密码已重置，原登录会话已失效"); setResetUser(null); passwordForm.resetFields(); }
    catch (error) { message.error(errorMessage(error)); }
  }

  async function saveIp(values: { cidr: string; label: string; enabled?: boolean }) {
    try {
      if (editingIp) await api.patch(`/admin/ip-rules/${editingIp.id}`, values);
      else await api.post("/admin/ip-rules", values);
      message.success(editingIp ? "IP 规则已更新" : "IP 规则已添加"); setIpModal(false); setEditingIp(null); ipForm.resetFields(); refreshIps();
    } catch (error) { message.error(errorMessage(error)); }
  }

  function openCreateIp() { setEditingIp(null); ipForm.resetFields(); ipForm.setFieldsValue({ enabled: true }); setIpModal(true); }
  function openEditIp(row: IpRule) { setEditingIp(row); ipForm.setFieldsValue(row); setIpModal(true); }

  async function toggleIp(row: IpRule, enabled: boolean) {
    try { await api.patch(`/admin/ip-rules/${row.id}`, { enabled }); refreshIps(); }
    catch (error) { message.error(errorMessage(error)); }
  }

  async function deleteIp(id: string) {
    try { await api.delete(`/admin/ip-rules/${id}`); message.success("IP 规则已删除"); refreshIps(); }
    catch (error) { message.error(errorMessage(error)); }
  }

  const userColumns: ColumnsType<UserRow> = [
    { title: "员工", key: "employee", render: (_value, row) => <div><div className="admin-user-name">{row.name}</div><Typography.Text type="secondary">{row.username} · {row.employeeNo || "无员工编号"}</Typography.Text></div> },
    { title: "部门", dataIndex: "department", key: "department", width: 130, render: (value) => value || "—" },
    { title: "角色", dataIndex: "role", key: "role", width: 130, render: (value) => <Tag color={value === "SUPER_ADMIN" ? "purple" : value === "ADMIN" ? "blue" : "default"}>{roleLabel[value] ?? value}</Tag> },
    { title: "员工状态", dataIndex: "employmentStatus", key: "employment", width: 100, render: (value) => <Tag color={value === "ACTIVE" ? "success" : "default"}>{employmentLabel[value] ?? value}</Tag> },
    { title: "账号状态", dataIndex: "accountStatus", key: "account", width: 90, render: (value) => value === "ACTIVE" ? <Tag color="success">正常</Tag> : <Tag color="error">禁用</Tag> },
    { title: "数据导入", dataIndex: "canImport", key: "import", width: 90, render: (value) => value ? <Tag color="blue">允许</Tag> : <Tag>只读</Tag> },
    { title: "创建时间", dataIndex: "createdAt", key: "created", width: 150, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    { title: "操作", key: "action", fixed: "right", width: 170, render: (_value, row) => isSuperAdmin || row.role === "EMPLOYEE" ? <Space size={4}><Button size="small" icon={<EditOutlined />} onClick={() => openEditUser(row)}>编辑</Button><Button size="small" icon={<KeyOutlined />} onClick={() => setResetUser(row)}>重置密码</Button></Space> : <Typography.Text type="secondary">仅超级管理员可管理</Typography.Text> },
  ];

  const ipColumns: ColumnsType<IpRule> = [
    { title: "允许访问的 IP / 网段", dataIndex: "cidr", key: "cidr", width: 240, render: (value) => <Typography.Text code>{value}</Typography.Text> },
    { title: "备注", dataIndex: "label", key: "label" },
    { title: "状态", dataIndex: "enabled", key: "enabled", width: 100, render: (value, row) => <Switch checked={value} checkedChildren="启用" unCheckedChildren="停用" onChange={(checked) => void toggleIp(row, checked)} /> },
    { title: "添加时间", dataIndex: "createdAt", key: "created", width: 160, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    { title: "操作", key: "action", width: 120, render: (_value, row) => <Space><Button size="small" icon={<EditOutlined />} onClick={() => openEditIp(row)}>编辑</Button><Popconfirm title="确定删除这条 IP 规则？" onConfirm={() => void deleteIp(row.id)}><Button danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><div className="eyebrow">ADMINISTRATION</div><Typography.Title level={2}>管理员设置</Typography.Title><Typography.Text type="secondary">维护员工账号和普通员工访问 IP 白名单。</Typography.Text></div><Tag color="purple">{roleLabel[currentUser?.role ?? "ADMIN"]}</Tag></div>
      <AlertText />
      <Tabs items={[
        { key: "users", label: "员工账号", children: <Card bordered={false} className="table-card"><div className="table-heading"><div><Typography.Title level={4}>员工账号管理</Typography.Title><Typography.Text type="secondary">员工必须保持在职且账号正常，才能登录系统。</Typography.Text></div><Button type="primary" icon={<PlusOutlined />} onClick={openCreateUser}>新增员工</Button></div><Table<UserRow> rowKey="id" loading={usersQuery.isLoading} columns={userColumns} dataSource={usersQuery.data ?? []} scroll={{ x: 1100 }} pagination={{ pageSize: 10, showSizeChanger: false }} /></Card> },
        { key: "ips", label: "IP 白名单", children: <Card bordered={false} className="table-card"><div className="table-heading"><div><Typography.Title level={4}>普通员工 IP 白名单</Typography.Title><Typography.Text type="secondary">普通员工必须从已启用的 IP 或 CIDR 网段访问；管理员不受白名单限制。</Typography.Text></div><Button type="primary" icon={<PlusOutlined />} onClick={openCreateIp}>添加 IP 规则</Button></div><Table<IpRule> rowKey="id" loading={ipsQuery.isLoading} columns={ipColumns} dataSource={ipsQuery.data ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} /></Card> },
      ]} />

      <Modal title={editingUser ? "编辑员工账号" : "新增员工账号"} open={userModal} onCancel={() => { setUserModal(false); setEditingUser(null); }} onOk={() => userForm.submit()} okText="保存" cancelText="取消" destroyOnHidden>
        <Form form={userForm} layout="vertical" onFinish={saveUser}>
          {!editingUser && <><Form.Item name="username" label="登录账号" rules={[{ required: true, message: "请输入登录账号" }]}><Input placeholder="例如：zhangsan" /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8, message: "密码至少 8 位" }]}><Input.Password placeholder="至少 8 位" /></Form.Item></>}
          <Form.Item name="name" label="员工姓名" rules={[{ required: true, message: "请输入姓名" }]}><Input /></Form.Item>
          {!editingUser && <Form.Item name="employeeNo" label="员工编号"><Input /></Form.Item>}
          <Form.Item name="department" label="所属部门"><Input /></Form.Item>
          {(isSuperAdmin || !editingUser) && <Form.Item name="role" label="账号角色" rules={[{ required: true }]}><Select options={(isSuperAdmin ? [{ label: "普通员工", value: "EMPLOYEE" }, { label: "管理员", value: "ADMIN" }] : [{ label: "普通员工", value: "EMPLOYEE" }])} disabled={Boolean(editingUser && !isSuperAdmin)} /></Form.Item>}
          {editingUser && <><Form.Item name="employmentStatus" label="员工状态"><Select options={[{ label: "在职", value: "ACTIVE" }, { label: "离职", value: "RESIGNED" }, { label: "停用", value: "SUSPENDED" }]} /></Form.Item><Form.Item name="accountStatus" label="账号状态"><Select options={[{ label: "正常", value: "ACTIVE" }, { label: "禁用", value: "DISABLED" }]} /></Form.Item></>}
          <Form.Item name="canImport" label="数据导入权限" valuePropName="checked"><Switch checkedChildren="允许导入" unCheckedChildren="只读" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`重置密码：${resetUser?.name ?? "员工"}`} open={Boolean(resetUser)} onCancel={() => { setResetUser(null); passwordForm.resetFields(); }} onOk={() => passwordForm.submit()} okText="确认重置" cancelText="取消" destroyOnHidden>
        <Form form={passwordForm} layout="vertical" onFinish={resetPassword}><Form.Item name="password" label="新密码" rules={[{ required: true, min: 8, message: "密码至少 8 位" }]}><Input.Password placeholder="输入新密码，至少 8 位" /></Form.Item></Form>
      </Modal>

      <Modal title={editingIp ? "编辑 IP 规则" : "添加 IP 规则"} open={ipModal} onCancel={() => { setIpModal(false); setEditingIp(null); }} onOk={() => ipForm.submit()} okText="保存" cancelText="取消" destroyOnHidden>
        <Form form={ipForm} layout="vertical" onFinish={saveIp}>
          <Form.Item name="cidr" label="IP 地址或 CIDR 网段" rules={[{ required: true, message: "请输入 IP 或网段" }]}><Input placeholder="例如：203.0.113.10 或 203.0.113.0/24" /></Form.Item>
          <Form.Item name="label" label="备注" rules={[{ required: true, message: "请输入备注" }]}><Input placeholder="例如：总部办公室" /></Form.Item>
          <Form.Item name="enabled" label="启用规则" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function AlertText() {
  return <div className="admin-note"><Typography.Text>管理员账号不受 IP 白名单限制。普通员工只有在职且来源 IP 命中启用规则时，才能登录和访问数据。</Typography.Text></div>;
}
