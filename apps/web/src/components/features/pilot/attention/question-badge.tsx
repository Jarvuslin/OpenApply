"use client";

import type { PropsWithChildren, ReactElement } from "react";
import { Badge } from "@mui/material";
import { useOpenQuestions } from "./use-open-questions";

export function QuestionBadge(props: PropsWithChildren): ReactElement {
  const { children } = props;
  const { questions } = useOpenQuestions();
  return <Badge badgeContent={questions.length}>{children}</Badge>;
}
