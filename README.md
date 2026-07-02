# AR Capture POC

Mobile-first proof of concept for a QR-linked AR capture game using a local `.glb` 3D character file, WebXR on supported Android devices, and an iOS-friendly camera/motion fallback.

## Run

```sh
python3 -m http.server 4173 --directory outputs/ar-capture-poc
```

Open:

```text
http://127.0.0.1:4173/?character=mr-ghost
```

## QR Character Links

The current POC is configured with one test character:

```text
http://127.0.0.1:4173/?character=mr-ghost
```

The id maps to this 3D asset:

```text
assets/mr-ghost.glb
```

## AR Behavior

Use `Enter AR` on a browser/device that supports WebXR `immersive-ar`, such as Chrome on a compatible Android device. The character is placed in world space around the player at a fixed near radius, then moves left/right/up/down around the player. It can leave the camera view, so the player must physically move or turn the phone to bring it back inside the capture box.

On iPhone/iPad, the primary action becomes `Start iOS AR` when the page is served over HTTPS. This opens the camera and uses device orientation when Safari grants motion access. It is not true ARKit world tracking, but it lets the capture game run on iOS with the player turning the phone to reacquire the character. Drag still works as a backup if motion permission is denied.

If the iPhone opens the site from a LAN HTTP URL such as `http://172.x.x.x:4173`, the button changes to `iOS Needs HTTPS`. In that mode Safari may load the page, but it will block camera and motion access. Use GitHub Pages or an HTTPS tunnel for iPhone testing.

On browsers without WebXR AR support or iOS motion support, `Drag Preview` runs the same 3D capture logic with a camera/video fallback. Drag on the screen to pan around and reacquire the character.

For production-quality iOS and Android browser AR with real world tracking, replace the AR provider with a cross-platform WebAR SDK such as 8th Wall or Zappar.
