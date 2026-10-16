import type { ReactElement } from "react";
import { Box, Card, Container, Stack, Typography } from "@mui/material";
import { CalendarClock, FileText, KeyRound, Mail, Send, ShieldCheck } from "lucide-react";
import { SectionHeading } from "../section-heading";

const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

const ITEMS = [
  {
    icon: <FileText {...ICON} />,
    title: "A resume for every job",
    body: "Keeps your original as the source of truth and tailors a version for each application, rendered to PDF.",
  },
  {
    icon: <KeyRound {...ICON} />,
    title: "Employer accounts made for you",
    body: "Uses one job login everywhere, creates accounts when a site needs one, and reads the verification code from Gmail.",
  },
  {
    icon: <ShieldCheck {...ICON} />,
    title: "Never applies twice",
    body: "Checks every job against what you already applied to, by link and by title and company.",
  },
  {
    icon: <CalendarClock {...ICON} />,
    title: "Your limits, enforced",
    body: "Set how many a day, how many per company, and how many at once. The server holds them even if the agent goes off-script.",
  },
  {
    icon: <Mail {...ICON} />,
    title: "Replies matched to jobs",
    body: "Reads recruiter replies from your Gmail and pairs each with the application it belongs to.",
  },
  {
    icon: <Send {...ICON} />,
    title: "A pipeline that fills itself",
    body: "Every submitted application lands in Applications with its status, so you always know where things stand.",
  },
];

export function BuiltIn(): ReactElement {
  return (
    <Box sx={{ bgcolor: "surfaces.elevated", py: { xs: 7, md: 12 } }}>
      <Container maxWidth="lg">
        <SectionHeading eyebrow="Built in" title="The tedious parts, handled" />
        <Box
          sx={{
            mt: 6,
            display: "grid",
            gap: 2.5,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "repeat(2, minmax(0, 1fr))",
              md: "repeat(3, minmax(0, 1fr))",
            },
          }}
        >
          {ITEMS.map((item) => (
            <Card key={item.title} sx={{ p: 3 }}>
              <Stack spacing={1.25}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "surfaces.hover",
                    color: "text.primary",
                  }}
                >
                  {item.icon}
                </Box>
                <Typography variant="h4" component="h3">
                  {item.title}
                </Typography>
                <Typography variant="body2Muted">{item.body}</Typography>
              </Stack>
            </Card>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
