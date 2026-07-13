# AR Capture POC

Mobile-first proof of concept for a QR-linked AR capture game using local `.glb` 3D character files. The primary AR path now uses the 8th Wall Engine for browser-based world tracking, with WebXR and iOS camera/motion fallback paths kept in place.

## Run

```sh
npm run serve
```

Open:

```text
http://127.0.0.1:4173/?character=mr-ghost
```

The server honors a `PORT` environment variable for 8th Wall Desktop / non-Studio workflows:

```sh
PORT=8888 npm run serve
```

Create a static bundle for drag-and-drop hosting:

```sh
npm run build
```

The build output is written to `dist/`.

## QR Character Links

The current POC is configured with two test characters:

```text
http://127.0.0.1:4173/?character=mr-ghost
http://127.0.0.1:4173/?character=saddie
```

The ids map to these 3D assets:

```text
assets/mr-ghost.glb
assets/saddie.glb
```

## AR Behavior

Use `Start Catch The Object` on a browser/device that can load the 8th Wall Engine. The game uses 8th Wall World Tracking first, placing the selected character in world space around the player. The character moves left/right/up/down around the player and can leave the camera view, so the player must physically move or turn the phone to bring it back inside the capture box.

If the 8th Wall Engine cannot load, the app falls back to WebXR `immersive-ar` on supported Android browsers, then to the iOS-friendly camera/motion fallback.

On iPhone/iPad, 8th Wall should provide the best WebAR tracking path when the engine loads over HTTPS. If it does not load, the fallback opens the camera and uses device orientation when Safari grants motion access. Drag still works as a backup if motion permission is denied.

If the iPhone opens the site from a LAN HTTP URL such as `http://172.x.x.x:4173`, the button changes to `iOS Needs HTTPS`. In that mode Safari may load the page, but it will block camera and motion access. Use GitHub Pages or an HTTPS tunnel for iPhone testing.

For GitHub Pages, push the project files or the contents of `dist/` to the published branch/folder. WebAR requires HTTPS for camera access.
