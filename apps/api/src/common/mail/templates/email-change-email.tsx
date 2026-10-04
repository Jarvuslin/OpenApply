import { Button, Heading, Link, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { body, button, fineprint, heading } from "./styles";

export const emailChangeEmailSubject = "Confirm your new email for OpenApply";

interface EmailChangeEmailProps {
  link: string;
}

/** Sent to the NEW address; the login email only switches when the link is clicked. */
export function EmailChangeEmail(props: EmailChangeEmailProps) {
  const { link } = props;
  return (
    <EmailLayout preview="Confirm your new OpenApply sign-in email">
      <Heading as="h2" style={heading}>
        Confirm your new email
      </Heading>
      <Text style={body}>
        Confirm this is your new sign-in address. Your OpenApply login email switches to this
        address once you confirm - until then, the old one keeps working.
      </Text>
      <Button href={link} style={button}>
        Confirm new email
      </Button>
      <Text style={fineprint}>
        Or paste this link into your browser:
        <br />
        <Link href={link}>{link}</Link>
      </Text>
      <Text style={fineprint}>
        This link expires in 1 hour. If you didn't request this change, you can ignore this email.
      </Text>
    </EmailLayout>
  );
}
