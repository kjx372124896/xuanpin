import { Button, Layout, Menu, Space } from "antd";
import { DatabaseOutlined, ImportOutlined, LogoutOutlined, SettingOutlined, ShopOutlined } from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const { Header, Sider, Content } = Layout;
const roleNames: Record<string, string> = { SUPER_ADMIN: "超级管理员", ADMIN: "管理员", EMPLOYEE: "员工" };

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const selectedKey = location.pathname.startsWith("/products/") ? "/" : location.pathname;
  const isProductList = location.pathname === "/";
  const items = [
    { key: "/", icon: <ShopOutlined />, label: "商品选品" },
    ...(user?.role !== "EMPLOYEE" || user.canImport ? [{ key: "/imports", icon: <ImportOutlined />, label: "数据导入" }] : []),
    ...(isAdmin ? [{ key: "/admin", icon: <SettingOutlined />, label: "管理员设置" }] : []),
  ];

  return (
    <Layout className="app-shell">
      <Sider width={224} theme="light" className="app-sider">
        <div className="brand-lockup">
          <div className="brand-icon"><DatabaseOutlined /></div>
          <div><div className="brand-title">选品数据中心</div><div className="brand-subtitle">PRODUCT INTELLIGENCE</div></div>
        </div>
        <div className="nav-caption">工作台</div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={items} onClick={({ key }) => navigate(key)} className="main-menu" />
        <div className="sider-footer">
          <div className="sider-footer-mark">SI</div>
          <div><div className="sider-footer-title">内部选品系统</div><div className="sider-footer-sub">数据仅供团队使用</div></div>
        </div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <div className="header-context">市场数据 · 商品趋势 · 周期追踪</div>
          <Space size={14}>
            <div className="user-chip"><div className="user-avatar">{user?.name?.slice(0, 1) || "U"}</div><div><div className="user-name">{user?.name}</div><div className="user-role">{roleNames[user?.role ?? "EMPLOYEE"]}</div></div></div>
            <Button type="text" icon={<LogoutOutlined />} onClick={() => void logout().then(() => navigate("/login"))}>退出</Button>
          </Space>
        </Header>
        <Content className={isProductList ? "app-content app-content-products" : "app-content"}><Outlet /></Content>
      </Layout>
    </Layout>
  );
}
