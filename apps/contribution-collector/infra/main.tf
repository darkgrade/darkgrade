terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "6.0.0" }
  }
}
variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "bucket_name" { type = string }
variable "collector_domain" {
  type        = string
  description = "Public collector DNS name; point its A record to collector_address before rollout."
}
variable "collector_image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.collector_image))
    error_message = "Pin the reviewed image by sha256 digest."
  }
}
variable "verification_keys" {
  type        = map(object({ publicKey = string, uploads = bool }))
  description = "Ed25519 public PEMs indexed by kid. Retain retired keys with uploads=false for withdrawal. Never provide private keys."
  validation {
    condition     = length(var.verification_keys) > 0 && alltrue([for key in values(var.verification_keys) : strcontains(key.publicKey, "BEGIN PUBLIC KEY") && !strcontains(key.publicKey, "PRIVATE KEY")])
    error_message = "Provide public verification keys only."
  }
}
variable "legacy_withdrawal_secret_id" {
  type        = string
  default     = null
  description = "Migration only: existing Secret Manager secret containing a JSON array of old HMAC keys. Accepted only for DELETE; never issue new HMAC grants."
}
variable "legacy_withdrawal_secret_version" {
  type    = string
  default = "1"
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.legacy_withdrawal_secret_version))
    error_message = "Pin the migration secret version."
  }
}
provider "google" {
  project = var.project_id
  region  = var.region
}
resource "google_project_service" "api" {
  for_each           = toset(["run.googleapis.com", "storage.googleapis.com", "firestore.googleapis.com", "compute.googleapis.com", "cloudscheduler.googleapis.com", "iam.googleapis.com", "secretmanager.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}
resource "google_service_account" "collector" {
  account_id = "darkgrade-contributions"
  depends_on = [google_project_service.api]
}
resource "google_storage_bucket" "contributions" {
  name                        = var.bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 0 }
  lifecycle_rule {
    condition {
      age            = 30
      matches_prefix = ["contributions/"]
    }
    action { type = "Delete" }
  }
  lifecycle_rule {
    condition {
      age            = 2
      matches_prefix = ["quotas/"]
    }
    action { type = "Delete" }
  }
  depends_on = [google_project_service.api]
}
resource "google_storage_bucket_iam_member" "collector" {
  bucket = google_storage_bucket.contributions.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.collector.email}"
}
resource "google_firestore_database" "contributions" {
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.api]
}
resource "google_firestore_field" "quota_expiry" {
  project    = var.project_id
  database   = google_firestore_database.contributions.name
  collection = "quotas"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}
resource "google_project_iam_member" "collector_database" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.collector.email}"
}
resource "google_secret_manager_secret_iam_member" "legacy_withdrawal" {
  count     = var.legacy_withdrawal_secret_id == null ? 0 : 1
  project   = var.project_id
  secret_id = var.legacy_withdrawal_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}
resource "google_cloud_run_v2_service" "collector" {
  name     = "darkgrade-contributions"
  location = var.region
  # Public run.app traffic cannot bypass Cloud Armor; Google load balancing is the public entry point.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  template {
    service_account                  = google_service_account.collector.email
    timeout                          = "30s"
    max_instance_request_concurrency = 16
    scaling {
      min_instance_count = 0
      max_instance_count = 20
    }
    containers {
      image = var.collector_image
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
      env {
        name  = "CONTRIBUTION_BUCKET"
        value = google_storage_bucket.contributions.name
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "CONTRIBUTION_VERIFICATION_KEYS"
        value = jsonencode(var.verification_keys)
      }
      dynamic "env" {
        for_each = var.legacy_withdrawal_secret_id == null ? [] : [var.legacy_withdrawal_secret_id]
        content {
          name = "CONTRIBUTION_LEGACY_WITHDRAWAL_KEYS"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = var.legacy_withdrawal_secret_version
            }
          }
        }
      }
    }
  }
  depends_on = [google_project_service.api, google_storage_bucket_iam_member.collector, google_project_iam_member.collector_database, google_firestore_database.contributions, google_secret_manager_secret_iam_member.legacy_withdrawal]
}
resource "google_cloud_run_v2_service_iam_member" "endpoint" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.collector.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
resource "google_compute_security_policy" "collector" {
  name = "darkgrade-contribution-front-door"
  dynamic "rule" {
    for_each = { POST = { priority = 100, count = 120 }, DELETE = { priority = 110, count = 30 } }
    content {
      priority = rule.value.priority
      action   = "throttle"
      match {
        expr { expression = "request.path == '/v1/contributions' && request.method == '${rule.key}'" }
      }
      rate_limit_options {
        conform_action = "allow"
        exceed_action  = "deny(429)"
        enforce_on_key = "IP"
        rate_limit_threshold {
          count        = rule.value.count
          interval_sec = 60
        }
      }
    }
  }
  rule {
    priority = 2147483647
    action   = "deny(403)"
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
  }
  depends_on = [google_project_service.api]
}
resource "google_compute_region_network_endpoint_group" "collector" {
  name                  = "darkgrade-contribution-run"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run { service = google_cloud_run_v2_service.collector.name }
}
resource "google_compute_backend_service" "collector" {
  name                  = "darkgrade-contribution-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.collector.id
  backend { group = google_compute_region_network_endpoint_group.collector.id }
}
resource "google_compute_global_address" "collector" {
  name       = "darkgrade-contribution-address"
  depends_on = [google_project_service.api]
}
resource "google_compute_managed_ssl_certificate" "collector" {
  name = "darkgrade-contribution-tls"
  managed { domains = [var.collector_domain] }
  depends_on = [google_project_service.api]
}
resource "google_compute_url_map" "collector" {
  name            = "darkgrade-contribution-routes"
  default_service = google_compute_backend_service.collector.id
}
resource "google_compute_target_https_proxy" "collector" {
  name             = "darkgrade-contribution-https"
  url_map          = google_compute_url_map.collector.id
  ssl_certificates = [google_compute_managed_ssl_certificate.collector.id]
}
resource "google_compute_global_forwarding_rule" "collector" {
  name                  = "darkgrade-contribution-https"
  target                = google_compute_target_https_proxy.collector.id
  port_range            = "443"
  ip_address            = google_compute_global_address.collector.address
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
resource "google_cloud_run_v2_job" "withdrawals" {
  name     = "darkgrade-withdrawals"
  location = var.region
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.collector.email
      timeout         = "240s"
      max_retries     = 3
      containers {
        image   = var.collector_image
        command = ["node"]
        args    = ["dist/withdrawal-worker.js"]
        env {
          name  = "CONTRIBUTION_BUCKET"
          value = google_storage_bucket.contributions.name
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
      }
    }
  }
  depends_on = [google_project_iam_member.collector_database, google_storage_bucket_iam_member.collector]
}
resource "google_service_account" "scheduler" {
  account_id = "darkgrade-withdrawal-scheduler"
  depends_on = [google_project_service.api]
}
resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.withdrawals.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}
resource "google_cloud_scheduler_job" "withdrawals" {
  name     = "darkgrade-withdrawal-retry"
  schedule = "*/5 * * * *"
  region   = var.region
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.withdrawals.name}:run"
    oauth_token { service_account_email = google_service_account.scheduler.email }
  }
  depends_on = [google_project_service.api, google_cloud_run_v2_job_iam_member.scheduler]
}
output "collector_url" { value = "https://${var.collector_domain}" }
output "collector_address" { value = google_compute_global_address.collector.address }
output "private_bucket" { value = google_storage_bucket.contributions.name }

variable "notification_channels" {
  type        = list(string)
  default     = []
  description = "Existing Cloud Monitoring channel resource names. Empty means incidents visible in Monitoring without notifications."
}
resource "google_logging_metric" "collector_outcomes" {
  name   = "darkgrade_contribution_outcomes"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.collector.name}\" AND jsonPayload.component=\"contribution-collector\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "outcome"
      value_type = "STRING"
    }
  }
  label_extractors = { outcome = "EXTRACT(jsonPayload.outcome)" }
  depends_on       = [google_project_service.api]
}
resource "google_logging_metric" "withdrawal_failures" {
  name   = "darkgrade_withdrawal_failures"
  filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.withdrawals.name}\" AND jsonPayload.component=\"contribution-withdrawal\" AND jsonPayload.failed>0"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
  depends_on = [google_project_service.api]
}
resource "google_monitoring_alert_policy" "collector_outcomes" {
  for_each              = toset(["rejected", "quota", "unavailable"])
  display_name          = "Darkgrade contribution ${each.key} spike"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "Repeated ${each.key} outcomes"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.collector_outcomes.name}\" AND metric.label.outcome = \"${each.key}\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = each.key == "unavailable" ? 0 : 20
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_project_service.api]
}
resource "google_monitoring_alert_policy" "withdrawals" {
  display_name          = "Darkgrade withdrawal cleanup failed"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "Withdrawal retry needs attention"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.withdrawal_failures.name}\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_project_service.api]
}
