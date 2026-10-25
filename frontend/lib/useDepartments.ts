"use client";

import { useEffect, useState } from "react";
import { listDepartments } from "./api";
import type { Department } from "./types";

// The department list for the "Who can see it?" picker
export function useDepartments(): { departments: Department[] | null; error: string | null } {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listDepartments()
      .then((items) => {
        if (active) setDepartments(items);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load departments.");
      });
    return () => {
      active = false;
    };
  }, []);

  return { departments, error };
}
