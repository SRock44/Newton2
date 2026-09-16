"""The one place URL-embedded, long-lived secrets are minted and checked.

Two features in this app hand a credential to a client that fundamentally CANNOT perform
the app's normal Keycloak bearer-token flow (app/core/auth.py):

  * the subscribable ICS calendar feed -- Google Calendar / Apple Calendar / Outlook
    refetch a subscribed URL on their own 12-24h schedule, with no user present, no
    refresh token, and no way to set an Authorization header;
  * public share links -- the recipient has no Newton account at all, so there is nothing
    to log in as.

Both therefore put the credential IN THE URL. That is a deliberate, standard design (it's
exactly what Google Calendar's own "secret address in iCal format" does), and this module
exists so that the two features share the one part that genuinely is the same -- how the
secret is generated and compared -- without pretending the two are the same feature. What
they do NOT share is storage or lifecycle: the calendar secret is exactly one per user,
lives as a column on `users`, and is rotated in place; a share link is one row per shared
object, many per user, and is destroyed rather than rotated.

Why these are emphatically NOT JWTs, and are never verified like one:

  * A JWT is *decoded* -- its payload is attacker-supplied structured data, and every
    JWT verification bug in the wild (alg=none, RS256->HS256 confusion, unverified `kid`
    fetches) comes from parsing that payload before/while trusting it. A token here is
    never parsed at all. It is compared, byte for byte, against a value this server
    generated and stored. There is no algorithm to confuse and no claims to forge.
  * The app's real access tokens are short-lived by design and refreshed by the desktop
    client. A calendar subscription must keep working untouched for months, which is
    exactly the property you must never give a session token.

Entropy: token_urlsafe(32) is 32 random bytes (256 bits) from the OS CSPRNG, rendered as
43 URL-safe base64 characters. Guessing one is not a threat model anyone needs to model.
"""

import secrets

# 32 bytes = 256 bits. Deliberately not "some number of characters": token_urlsafe's
# argument is BYTES of entropy, and conflating the two is how a 16-character token gets
# mistaken for 16 bytes of randomness.
TOKEN_ENTROPY_BYTES = 32


def generate_token() -> str:
    """A fresh, unguessable, URL-safe secret. The ONLY way a token in this app is ever
    created -- nothing derives one from a user id, an email, a timestamp or a counter,
    all of which would make tokens correlatable or enumerable."""
    return secrets.token_urlsafe(TOKEN_ENTROPY_BYTES)


def tokens_match(presented: str | None, stored: str | None) -> bool:
    """Constant-time equality for a URL-supplied token against the stored one.

    compare_digest rather than `==` so an attacker can't use response-timing to learn a
    correct prefix one character at a time. A None on either side is an unconditional
    no -- a user who has never minted a feed token must not be matchable by a caller who
    also sends nothing, which a naive `presented == stored` would happily allow.
    """
    if not presented or not stored:
        return False
    return secrets.compare_digest(presented, stored)
