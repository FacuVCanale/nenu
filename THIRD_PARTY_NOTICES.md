# Third-party notices

## Collie project origin

Nenu originated as a fork of [Collie](https://github.com/AltanS/collie), created by
[Altan Sarisin](https://github.com/AltanS). Collie provided the original Herdr bridge, self-hosted
PWA, Tailscale access, notification system, terminal controls, and much of the repository history
on which Nenu continues to build.

Collie is distributed under the MIT License. Its original copyright and full license terms are
preserved in Nenu's root [LICENSE](LICENSE) file.

## T3 Code UI adaptations

Nenu's workbench uses theme values and layout/control styling adapted from
[T3 Code](https://github.com/pingdotgg/t3code), commit
`191a4ef754b2e679f74a49230b34b48e42688349`:

- `apps/web/src/index.css`: light/dark surface palette and typography.
- `apps/web/src/components/AppSidebarLayout.tsx` and `sidebar/SidebarChrome.tsx`: sidebar layout.
- `apps/web/src/components/chat/ContextWindowMeter.tsx` and `lib/contextWindow.ts`: context ring and token formatting.
- `apps/web/src/components/chat/ModelListRow.tsx`: native model and reasoning picker row styling.
- `apps/web/src/routes/_chat.index.tsx`: home hero and contextual entry-point styling.
- `apps/web/src/composer-logic.ts` and `apps/web/src/components/chat/ChatComposer.tsx`: provider-aware command completion and insert-only selection.
- `apps/web/src/components/ui/toast.tsx`: compact top-right notification surface and typography.
- `apps/web/src/components/chat/MessagesTimeline.tsx` and `MessagesTimeline.logic.ts`: work grouping, minimal disclosures, separate final answers, and isolated elapsed-time updates.

Adaptations retain Nenu's identity, React Router navigation, Herdr transport,
and guarded terminal input. They do not use T3 Code's orchestration runtime.

MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Fonts

DM Sans Variable and JetBrains Mono 400/500 are the fonts selected by T3 Code's
web client. Latin WOFF2 subsets are vendored from Fontsource packages
`@fontsource-variable/dm-sans@5.2.8` and `@fontsource/jetbrains-mono@5.2.8`.
Both use the SIL Open Font License 1.1; complete notices are in
`web/public/fonts/dm-sans-LICENSE.txt` and
`web/public/fonts/jetbrains-mono-LICENSE.txt`. Existing Nerd Font subsets and
`web/public/fonts/LICENSE.txt` remain unchanged.

## PDF.js

The optional document viewer uses Mozilla PDF.js (`pdfjs-dist`), licensed under Apache-2.0.
The full license is distributed at `web/public/pdfjs-LICENSE.txt`. Font and image decoder notices
are also included alongside the lazily served PDF.js resources. See
[PDF.js examples](https://mozilla.github.io/pdf.js/examples/) for the document/page rendering API.

## Icons

Nenu's icons are vendored as SVG path data in `web/src/components/ui/icon.tsx`; no icon package
ships at runtime. Most glyphs are Hugeicons Stroke Rounded from `@hugeicons/core-free-icons@4.3.5`;
the agent and message glyphs (`sparkle`, `chat-circle` and its variants) are Phosphor Regular from
`@phosphor-icons/core@2.1.1`. Both are MIT licensed:

```
MIT License

Copyright (c) 2025 Hugeicons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
