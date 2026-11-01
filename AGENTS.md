# Working location

The primary project is `/home/edp1096/workspace/manga_translator` on OP5P at
`192.168.100.25`. Edit source, build releases, and keep project evidence here.
The user's established work and application data live on this host.

DGX Spark is an auxiliary host for CUDA/Vulkan verification only. A copy there
is not the source of truth. Never overwrite OP5P changes from a stale auxiliary
copy. Bring GPU verification results back to this project.

Preserve existing model downloads, settings, credentials, translation results,
and unrelated projects. Check for active application processes before updating
the live release. Keep archived releases under `archive/`. The installed portable
application is `/home/edp1096/tools/manga-translator/`; `dist/` contains generated
build artifacts only and may be deleted. Never infer the live application's
state from `dist/`.

The controller must build with `CGO_ENABLED=0`. Hardware discovery must use Go
and OS/driver APIs, without external hardware-information helper commands.
