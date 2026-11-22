import { Button, Layout, Menu } from "antd";
import { AppstoreOutlined, DatabaseOutlined, ImportOutlined, KeyOutlined, LineChartOutlined, LogoutOutlined, SettingOutlined, ShopOutlined } from "@ant-design/icons";
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
  const isCompactDataPage = isProductList || location.pathname === "/search-trends";
  const items = [
    { key: "/", icon: <ShopOutlined />, label: "商品选品" },
    { key: "/search-trends", icon: <LineChartOutlined />, label: "搜索趋势" },
    { key: "/categories", icon: <AppstoreOutlined />, label: "类目管理" },
    ...(isAdmin ? [{ key: "/dmp-auth", icon: <KeyOutlined />, label: "达摩盘授权 / 后台任务" }] : []),
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
          <div className="user-avatar sider-user-avatar">{user?.name?.slice(0, 1) || "U"}</div>
          <div className="sider-footer-user">
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{roleNames[user?.role ?? "EMPLOYEE"]}</div>
          </div>
          <Button type="text" icon={<LogoutOutlined />} title="退出登录" aria-label="退出登录" onClick={() => void logout().then(() => navigate("/login"))}>退出</Button>
        </div>
      </Sider>
      <Layout>
        {!isCompactDataPage && <Header className="app-header"><div className="header-context">市场数据 · 商品趋势 · 周期追踪</div></Header>}
        <Content className={isCompactDataPage ? "app-content app-content-products" : "app-content"}><Outlet /></Content>
      </Layout>
    </Layout>
  );
}
