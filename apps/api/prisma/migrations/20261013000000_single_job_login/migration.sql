-- One job login per user. A complete signup login replaces the default one, per-site logins are
-- dropped, and when both captcha services are saved only 2captcha is kept.
BEGIN;

DELETE FROM credentials d
USING credentials s
WHERE d.user_id = s.user_id
  AND d.scope = 'default'
  AND s.scope = 'signup'
  AND s.email IS NOT NULL
  AND s.password IS NOT NULL;

UPDATE credentials c
SET scope = 'default'
WHERE c.scope = 'signup'
  AND c.email IS NOT NULL
  AND c.password IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM credentials o WHERE o.user_id = c.user_id AND o.scope = 'default');

DELETE FROM credentials WHERE scope NOT IN ('default', '2captcha', 'capsolver');

DELETE FROM credentials c
WHERE c.scope = 'capsolver'
  AND EXISTS (SELECT 1 FROM credentials o WHERE o.user_id = c.user_id AND o.scope = '2captcha');

COMMIT;
