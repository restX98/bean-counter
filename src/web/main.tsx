import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "../../docs/design/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/controls.css";
import "./styles/content.css";
import { Shell } from "./components/Shell.tsx";
import { AccountDetail } from "./pages/AccountDetail.tsx";
import { Accounts } from "./pages/Accounts.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { More } from "./pages/More.tsx";
import { NotBuilt, NotFound } from "./pages/NotBuilt.tsx";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "accounts", element: <Accounts /> },
      { path: "accounts/:id", element: <AccountDetail /> },
      { path: "more", element: <More /> },
      { path: "import", element: <NotBuilt title="Import" inMore /> },
      { path: "review", element: <NotBuilt title="Review" inMore /> },
      { path: "transactions", element: <NotBuilt title="Transactions" /> },
      { path: "reports", element: <NotBuilt title="Reports" /> },
      { path: "budgets", element: <NotBuilt title="Budgets" /> },
      { path: "categories", element: <NotBuilt title="Categories" inMore /> },
      { path: "rules", element: <NotBuilt title="Rules" inMore /> },
      { path: "settings", element: <NotBuilt title="Settings" inMore /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
