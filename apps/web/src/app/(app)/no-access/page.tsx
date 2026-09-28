"use client";

import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/primitives";
import { useAccess, useUi } from "@/hooks/use-sabai";

/** Never a dead end: explain in plain words and offer the one useful action. */
export default function NoAccessPage() {
  const { member, role } = useAccess();
  const setSwitchUserOpen = useUi((s) => s.setSwitchUserOpen);
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        emoji="🔒"
        title="ส่วนนี้ยังไม่ได้เปิดให้ตำแหน่งของคุณ"
        description={`${member?.name ?? "คุณ"} (${role?.name ?? "ไม่มีตำแหน่ง"}) ยังไม่มีสิทธิ์ใช้หน้านี้ ถ้าต้องใช้งาน บอกเจ้าของร้านให้เปิดสิทธิ์ในหน้า "ทีมงาน" ได้เลย`}
        action={
          <Button icon={<Users className="h-4 w-4" />} onClick={() => setSwitchUserOpen(true)}>
            สลับผู้ใช้
          </Button>
        }
      />
    </Card>
  );
}
