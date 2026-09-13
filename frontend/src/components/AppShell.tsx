import { Outlet } from "react-router-dom";
import Header from "./Header";
import Sidebar from "./Sidebar";
import Footer from "./Footer";

export default function AppShell() {
  return (
    <div className="shell">
      <Header />
      <div className="body">
        <Sidebar />
        <main className="content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
