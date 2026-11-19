# Changelog

## 0.3.0, pre-release package (19 Nov 2026)

- Full Gate 2 release screenshot matrix (320 to 1920, both themes,
  confirmation sheet states) rendered and inspected; zero horizontal
  overflow, zero visual regression from the approved design.
- Confirmation sheet dialog semantics completed: Escape closes it,
  focus moves to its heading on open and returns to the opener on
  close, Tab cycles inside (evaluation finding F-10).
- CSP connect-src now lists the testnet RPC origins alongside the
  mainnet ones (finding F-11); the preview Worker additionally sends
  a CSP header with frame-ancestors 'none', X-Content-Type-Options
  nosniff, X-Frame-Options DENY, a minimal Permissions-Policy, and
  HSTS.
- Open Graph and Twitter card metadata, a 1200x630 OG image built
  from the product's real testnet label card, and an SVG favicon.
- Public repository, MIT licence, agent.md, and this changelog.

## 0.2.0, pre-release evaluation (19 Nov 2026)

- Full evaluation against a written rubric (Nielsen, cognitive
  walkthrough, OWASP Top 10:2025, WCAG 2.2, official jury weights):
  weighted score 8.10 of 10, zero Critical or High findings.
- Fixed: name length limit raised from 15 to the registry's real 20
  (the old input silently truncated names), a Keccak padding bug on
  inputs of length 135 mod 136 found by fuzzing against ethers, and
  the confirmation sheet now closes on account or chain change.
- Fee display on the confirmation sheet rounds to at most 6 decimals
  (display only); escrow list loading uses bounded concurrency of 3.

## 0.1.0, testnet proof (19 Nov 2026)

- TitipEscrow deployed on BSC Testnet against a mock Agent ID
  registry; claim and refund flows proven live with payouts
  reconciled to the wei; source verified as a Sourcify exact match.
- Page-driven transaction adapter (create card, deposit, claim,
  refund) proven end to end from the product page on testnet.
- Parcel-label visual design approved; dark default theme plus a
  separately designed light theme; full ID/EN dictionaries.
