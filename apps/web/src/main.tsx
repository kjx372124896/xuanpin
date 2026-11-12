import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "antd/dist/reset.css";
import "./styles.css";
import { AuthProvider } from "./auth/AuthContext";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: "#315efb", borderRadius: 10, fontFamily: "Inter, 'Microsoft YaHei', sans-serif" } }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter><App /></BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
