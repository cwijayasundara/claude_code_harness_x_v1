# Reference patterns

List only proven local implementations that new changes should extend rather than duplicate.

| Need | Canonical path | Rule |
|---|---|---|
| Add an API endpoint | _Add project path_ | Follow the existing router/service/contract seam. |
| Add a domain rule | _Add project path_ | Put the rule behind the named domain abstraction; add an approved fixture. |

Delete stale patterns. This file is a navigation aid, not an encyclopedia.
