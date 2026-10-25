import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "../../docs/design/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/controls.css";
import "./styles/content.css";
import "./styles/flow.css";
import { Shell, type RouteHandle } from "./components/Shell.tsx";
import { AccountDetail } from "./pages/AccountDetail.tsx";
import { Accounts } from "./pages/Accounts.tsx";
import { BalanceReport } from "./pages/BalanceReport.tsx";
import { BudgetDetail } from "./pages/BudgetDetail.tsx";
import { Budgets } from "./pages/Budgets.tsx";
import { Categories } from "./pages/Categories.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Import } from "./pages/import/Import.tsx";
import { More } from "./pages/More.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Reports } from "./pages/Reports.tsx";
import { Review } from "./pages/Review.tsx";
import { Rules } from "./pages/Rules.tsx";
import { EditPreset } from "./pages/EditPreset.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Spending } from "./pages/Spending.tsx";
import { Transactions } from "./pages/Transactions.tsx";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "accounts", element: <Accounts /> },
      { path: "accounts/:id", element: <AccountDetail /> },
      { path: "more", element: <More /> },
      {
        path: "import",
        element: <Import />,
        handle: { fullScreen: true } satisfies RouteHandle,
      },
      { path: "review", element: <Review /> },
      { path: "transactions", element: <Transactions /> },
      { path: "reports", element: <BalanceReport /> },
      { path: "reports/monthly", element: <Reports /> },
      { path: "reports/spending", element: <Spending /> },
      { path: "budgets", element: <Budgets /> },
      { path: "budgets/:id", element: <BudgetDetail /> },
      { path: "categories", element: <Categories /> },
      { path: "rules", element: <Rules /> },
      { path: "settings", element: <Settings /> },
      {
        path: "settings/presets/:id",
        element: <EditPreset />,
        handle: { fullScreen: true } satisfies RouteHandle,
      },
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
