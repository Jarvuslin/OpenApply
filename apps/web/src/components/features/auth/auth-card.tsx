import type { PropsWithChildren, ReactElement } from "react";
import { Box, Card, CardContent, Container, Stack, Typography } from "@mui/material";
import { OpenApplyMark } from "@/components/brand/openapply-mark";

interface AuthCardProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
}

/**
 * Centered, full-height frame for the unauthenticated login/register screens.
 * Renders the OpenApply wordmark above a single card so both pages share one
 * look without pulling in the app rail/shell.
 */
export function AuthCard(props: AuthCardProps): ReactElement {
  const { title, subtitle, children } = props;
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "surfaces.base",
        py: { xs: 4, sm: 6 },
      }}
    >
      <Container maxWidth="xs">
        <Stack spacing={3}>
          <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <OpenApplyMark size={36} />
              <Typography variant="h2" component="h1">
                OpenApply
              </Typography>
            </Stack>
            <Typography variant="body2Muted">Your job search, in one place.</Typography>
          </Stack>
          <Card>
            <CardContent sx={{ p: { xs: 3, sm: 4 }, "&:last-child": { pb: { xs: 3, sm: 4 } } }}>
              <Stack spacing={3}>
                <Stack spacing={0.5}>
                  <Typography variant="h3" component="h2">
                    {title}
                  </Typography>
                  {subtitle && <Typography variant="body2Muted">{subtitle}</Typography>}
                </Stack>
                {children}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
