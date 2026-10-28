"""Django settings. Everything environment-specific comes from env vars (see DEPLOY.md)."""
import os
from pathlib import Path
from urllib.parse import quote

BASE_DIR = Path(__file__).resolve().parent.parent

ON_RENDER = bool(os.environ.get("RENDER"))
DEBUG = os.environ.get("DEBUG") == "1"

SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("SECRET_KEY is not set (Render generates it from render.yaml)")
    SECRET_KEY = "dev-only-not-a-secret"

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
CSRF_TRUSTED_ORIGINS = []
render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
if render_host:
    ALLOWED_HOSTS.append(render_host)
    CSRF_TRUSTED_ORIGINS.append(f"https://{render_host}")
for host in filter(None, os.environ.get("EXTRA_HOSTS", "").split(",")):  # custom domain
    ALLOWED_HOSTS.append(host.strip())
    CSRF_TRUSTED_ORIGINS.append(f"https://{host.strip()}")

if ON_RENDER:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

LOGIN_REDIRECT_URL = "/"

INSTALLED_APPS = [
    'ticketsystem.apps.TicketsystemConfig',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'company.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / "templates"],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'company.wsgi.application'


def database_from_env():
    """DATABASE_URL=libsql://<db>-<org>.turso.io (+ DATABASE_AUTH_TOKEN) -> Turso; unset -> local db.sqlite3.
    Render's free disk is wiped on every deploy/spin-down, so a file DB there would silently lose data."""
    url = os.environ.get("DATABASE_URL", "")
    # libsql_client only speaks websocket; plaintext ws:// is allowed for a local sqld only
    local_sqld = url.startswith(("ws://127.0.0.1", "ws://localhost"))
    if "://" in url and not (url.startswith(("libsql://", "wss://")) or local_sqld):
        raise RuntimeError("DATABASE_URL must be libsql://, wss://, or ws://127.0.0.1 (local sqld)")
    if "://" in url:
        token = os.environ.get("DATABASE_AUTH_TOKEN")
        if not token:
            raise RuntimeError("DATABASE_AUTH_TOKEN is required for a libsql:// DATABASE_URL")
        return {'ENGINE': 'company.libsql_backend', 'NAME': f"{url}?authToken={quote(token)}"}
    if ON_RENDER:
        raise RuntimeError("DATABASE_URL must be a libsql:// Turso URL on Render (its disk is ephemeral)")
    return {'ENGINE': 'django.db.backends.sqlite3', 'NAME': Path(url.removeprefix("file:")) if url else BASE_DIR / 'db.sqlite3'}


DATABASES = {'default': database_from_env()}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'tr-tr'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
