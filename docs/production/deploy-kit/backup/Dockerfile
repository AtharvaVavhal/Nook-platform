# Backup job image (Railway cron service). Prepared, NOT deployed: no AWS resource exists yet.
# PostgreSQL 17.11 client (the same major as the server, so pg_dump can dump it; the tag matches the 17.11 server, though a
# 17.x client of any minor works against it), age for client-side encryption, AWS CLI for upload.
# Build with RAILWAY_DOCKERFILE_PATH pointing at this file on the backup service only (a Dockerfile at the repository
# root would be picked up by every service).
FROM postgres:17.11
RUN apt-get update \
 && apt-get install -y --no-install-recommends age awscli ca-certificates curl openssl \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh /usr/local/bin/nook-backup.sh
RUN chmod 0755 /usr/local/bin/nook-backup.sh
# The cron service runs this start command on its schedule and it must exit when done.
CMD ["/usr/local/bin/nook-backup.sh"]
