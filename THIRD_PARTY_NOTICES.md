# Third-party notices

The Linux desktop image arrangement in `server/computer/` is adapted from
unGrokBot. It contains no extracted Grok application assets.

MIT License

Copyright (c) 2026 Dafydd Thomas

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

Runtime packages in the desktop image, noVNC, and other dependencies retain
their respective licenses. This project does not bundle the Hermes runtime.

## noVNC

The unmodified noVNC 1.7.0 core is bundled in the screen client under the Mozilla
Public License 2.0. Copyright belongs to the noVNC authors. Its source is available
at https://github.com/novnc/noVNC/tree/v1.7.0 and through the pinned npm package
`@novnc/novnc`. The license and notice are included in `licenses/`.

## Mobile runtime

The mobile clients use unmodified Capacitor and its App/Keyboard plugins under
MIT, and `@aparajita/capacitor-secure-storage` under MIT. The latter uses
KeychainSwift under MIT on iOS and Android platform cryptography. Native dependency
licenses remain with those packages. Source and license text are available in the
locked npm packages and at:

- https://github.com/ionic-team/capacitor
- https://github.com/ionic-team/capacitor-plugins
- https://github.com/aparajita/capacitor-secure-storage
- https://github.com/evgenyneu/keychain-swift

The mobile avatar and launcher artwork are original project assets. The native
project templates derive from Capacitor's MIT-licensed templates.
