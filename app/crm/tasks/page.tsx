"use client";

/**
 * /crm/tasks — "สิ่งที่ต้องทำ" as its own page.
 *
 * Extracted (spec: move-task-board-to-own-page) from what used to be an
 * inline block on `/crm/alerts`, below the automatic alert feed. On a busy
 * week that feed grows long enough that the one thing the owner writes down
 * himself ended up buried several screens down — moving it to its own page
 * means it is never buried, at the cost of one click to get here (a button
 * on `/crm/alerts`, in the exact spot the inline board used to occupy).
 *
 * This page owns everything the board itself needs: topics, create/edit,
 * the topic manager, and reveal-after-save — the same state `/crm/alerts`
 * used to hold. Customer/equipment chips on a task card still open
 * `CustomerDetailsModal`/`EquipmentDetailsModal` IN PLACE here too (spec:
 * open-task-chip-targets-in-place didn't stop applying just because the
 * board moved) via the same shared `useCustomerEquipmentDetails` hook
 * `/crm/alerts` uses, so the two pages can never drift on that behavior.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import type { CrmTask, CustomerEquipment, TaskTopic } from "../../lib/types";
import TaskBoardSection from "../../components/TaskBoardSection";
import TaskFormModal from "../../components/TaskFormModal";
import TaskTopicManagerModal from "../../components/TaskTopicManagerModal";
import EquipmentDetailsModal from "../../components/modals/EquipmentDetailsModal";
import EquipmentEditModal from "../../components/modals/EquipmentEditModal";
import CustomerDetailsModal from "../../components/modals/CustomerDetailsModal";
import { useCustomerEquipmentDetails } from "../../components/useCustomerEquipmentDetails";

export default function TasksPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [topics, setTopics] = useState<TaskTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [taskModal, setTaskModal] = useState<{ task: CrmTask | null } | null>(null);
  const [revealTask, setRevealTask] = useState<CrmTask | null>(null);
  const [showTopicManager, setShowTopicManager] = useState(false);

  const [editingEquipment, setEditingEquipment] = useState<CustomerEquipment | null>(null);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, authLoading, router]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleUnauthorized = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const {
    viewingCustomerDetails,
    setViewingCustomerDetails,
    viewingEquipmentDetails,
    setViewingEquipmentDetails,
    openCustomerProfile,
    openEquipmentDetails,
  } = useCustomerEquipmentDetails(showToast);

  const fetchTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const res = await fetch("/api/admin/task-topics?includeHidden=1");
      if (res.status === 401) {
        handleUnauthorized();
        setTopicsError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        return;
      }
      if (!res.ok) throw new Error("โหลดหัวข้องานไม่สำเร็จ");
      const data = await res.json();
      setTopics(Array.isArray(data) ? (data as TaskTopic[]) : []);
      setTopicsError(null);
    } catch (err) {
      console.error(err);
      setTopicsError("โหลดหัวข้องานไม่สำเร็จ");
    } finally {
      setTopicsLoading(false);
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    if (isLoggedIn) fetchTopics();
  }, [isLoggedIn, fetchTopics]);

  const activeTopics = topics.filter((topic) => topic.isActive !== false);

  return (
    <div className="min-h-screen bg-gray-50/50">
      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-top-4 fade-in">
          <Toast message={toast.message} type={toast.type} />
        </div>
      )}

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <Link
            href="/crm/alerts"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors mb-3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            กลับไปหน้าแจ้งเตือน
          </Link>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-xl shadow-sm">
              📝
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">สิ่งที่ต้องทำ</h1>
          </div>
          <p className="text-sm text-gray-500 font-medium ml-13">
            รายการที่คุณจดไว้เอง ไม่ใช่แจ้งเตือนอัตโนมัติของระบบ — อยู่จนกว่าคุณจะกดว่าเสร็จ
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <TaskBoardSection
          topics={topics}
          topicsLoading={topicsLoading}
          topicsError={topicsError}
          onRetryTopics={fetchTopics}
          onCreateTask={() => setTaskModal({ task: null })}
          onEditTask={(task) => setTaskModal({ task })}
          onManageTopics={() => setShowTopicManager(true)}
          refreshKey={boardRefreshKey}
          revealTask={revealTask}
          onToast={showToast}
          onUnauthorized={handleUnauthorized}
          // Customer/equipment chips open the shared details modal IN PLACE
          // instead of navigating (spec: open-task-chip-targets-in-place) —
          // same fetch-and-open functions /crm/alerts' own "แก้ไข" button uses.
          onOpenCustomer={openCustomerProfile}
          onOpenEquipment={openEquipmentDetails}
        />
      </div>

      {taskModal && (
        <TaskFormModal
          task={taskModal.task}
          topics={activeTopics}
          onClose={() => setTaskModal(null)}
          onSaved={(task) => {
            setTaskModal(null);
            setRevealTask(task);
            showToast("บันทึกงานสำเร็จ", "success");
          }}
        />
      )}

      {showTopicManager && (
        <TaskTopicManagerModal
          initialTopics={topics}
          onClose={() => setShowTopicManager(false)}
          onTopicsChanged={(next) => setTopics(next)}
          // A rename or recolour rewrites no task row, but every card displays
          // it — so the list has to be re-pulled.
          onSaveSuccess={() => setBoardRefreshKey((key) => key + 1)}
        />
      )}

      {viewingEquipmentDetails && (
        <EquipmentDetailsModal
          equipment={viewingEquipmentDetails}
          onClose={() => setViewingEquipmentDetails(null)}
          onEditEquipment={(eq) => {
            setViewingEquipmentDetails(null);
            setEditingEquipment(eq);
          }}
          // Same `revealTask` mechanism the board's own "สร้างงานใหม่" button
          // uses — makes a task created from inside this modal show up on
          // the board above without a manual refresh.
          onTaskCreated={setRevealTask}
        />
      )}

      {editingEquipment && (
        <EquipmentEditModal
          initialData={editingEquipment}
          onClose={() => setEditingEquipment(null)}
          onSaveSuccess={() => {
            setEditingEquipment(null);
            showToast("บันทึกข้อมูลสำเร็จ", "success");
          }}
        />
      )}

      {viewingCustomerDetails && (
        <CustomerDetailsModal
          customer={viewingCustomerDetails}
          onClose={() => setViewingCustomerDetails(null)}
          onSaved={setViewingCustomerDetails}
          showToast={showToast}
          onTaskCreated={setRevealTask}
        />
      )}
    </div>
  );
}
