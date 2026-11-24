import {BellRing, LayoutDashboard, Route as RouteIcon, UsersRound} from "lucide-react";

export const NAV_ITEMS = [
    {
        id: "overview",
        label: "Executive Overview",
        icon: LayoutDashboard,
        allUlbs: true,
    },
    {
        id: "route",
        label: "Beat/Route Enhancement",
        icon: RouteIcon,
        disabledTitle: "Select one ULB to use route planning.",
    },
    {
        id: "analytics",
        label: "Employee Analysis",
        icon: UsersRound,
        disabledTitle: "Select one ULB to use employee analysis.",
    },
    {
        id: "alerts",
        label: "Employee Alert",
        icon: BellRing,
        disabledTitle: "Select one ULB to view employee alerts.",
    },
];
