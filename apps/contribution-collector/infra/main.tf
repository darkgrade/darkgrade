terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source = "hashicorp/google", version = "6.0.0"
    }
  }
  # Supply a private, versioned state bucket through -backend-config during init.
  backend "gcs" {
  }
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "collector_image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.collector_image))
    error_message = "Pin the reviewed image digest."
  }
}

variable "public_url" {
  type = string
  validation {
    condition     = can(regex("^https://[a-zA-Z0-9.-]+$", var.public_url))
    error_message = "Provide the public HTTPS collector origin without a trailing slash."
  }
}

variable "allowed_origins" {
  type    = list(string)
  default = []
}

variable "email_secret_id" {
  type    = string
  default = null
}

variable "email_secret_version" {
  type    = string
  default = "1"
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.email_secret_version))
    error_message = "Pin a numeric email secret version."
  }
}

variable "email_from" {
  type    = string
  default = ""
}

variable "notification_channels" {
  type    = list(string)
  default = []
}

variable "billing_account" {
  type = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 50
  validation {
    condition     = var.monthly_budget_usd > 0 && floor(var.monthly_budget_usd) == var.monthly_budget_usd
    error_message = "Use a positive whole-dollar budget."
  }
}

variable "deploy_ref" {
  type    = string
  default = "refs/heads/main"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "api" {
  for_each           = toset(["run.googleapis.com", "firestore.googleapis.com", "cloudscheduler.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com", "billingbudgets.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "collector" {
  account_id = "darkgrade-telemetry"
  depends_on = [google_project_service.api]
}

resource "google_firestore_database" "telemetry" {
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.api]
}

resource "google_firestore_field" "expiry" {
  for_each   = toset(["diagnostics", "contactChallenges", "uploadQuotas", "enrollmentQuotas"])
  database   = google_firestore_database.telemetry.name
  collection = each.value
  field      = "expiresAt"
  ttl_config {
  }
  index_config {
  }
}

resource "google_firestore_field" "payload" {
  database   = google_firestore_database.telemetry.name
  collection = "diagnostics"
  field      = "payload"
  index_config {
  }
}

resource "google_project_iam_member" "database" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_artifact_registry_repository" "telemetry" {
  location      = var.region
  repository_id = "darkgrade-telemetry"
  format        = "DOCKER"
  depends_on    = [google_project_service.api]
}

resource "google_secret_manager_secret_iam_member" "email" {
  count     = var.email_secret_id == null ? 0 : 1
  secret_id = var.email_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_cloud_run_v2_service" "collector" {
  name     = "darkgrade-telemetry"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = google_service_account.collector.email
    timeout                          = "30s"
    max_instance_request_concurrency = 16
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.collector_image
      resources {
        limits = {
          cpu = "1", memory = "256Mi"
        }
        cpu_idle = true
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "TELEMETRY_PUBLIC_URL"
        value = var.public_url
      }
      env {
        name  = "TELEMETRY_ALLOWED_ORIGINS"
        value = jsonencode(var.allowed_origins)
      }
      env {
        name  = "TELEMETRY_EMAIL_FROM"
        value = var.email_from
      }
      dynamic "env" {
        for_each = var.email_secret_id == null ? [] : [var.email_secret_id]
        content {
          name = "TELEMETRY_EMAIL_API_KEY"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = var.email_secret_version
            }
          }
        }
      }
    }
  }
  depends_on = [google_project_iam_member.database, google_firestore_database.telemetry, google_secret_manager_secret_iam_member.email]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  location = var.region
  name     = google_cloud_run_v2_service.collector.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "cleanup" {
  name     = "darkgrade-telemetry-cleanup"
  location = var.region
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.collector.email
      timeout         = "1800s"
      max_retries     = 3
      containers {
        image   = var.collector_image
        command = ["node"]
        args    = ["dist/operations.js", "cleanup"]
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
      }
    }
  }
  depends_on = [google_project_iam_member.database, google_firestore_database.telemetry]
}

resource "google_service_account" "scheduler" {
  account_id = "darkgrade-telemetry-scheduler"
  depends_on = [google_project_service.api]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  location = var.region
  name     = google_cloud_run_v2_job.cleanup.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "cleanup" {
  name      = "darkgrade-telemetry-cleanup"
  region    = var.region
  schedule  = "0 3 * * *"
  time_zone = "Etc/UTC"
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.cleanup.name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
  depends_on = [google_project_service.api, google_cloud_run_v2_job_iam_member.scheduler]
}

resource "google_monitoring_alert_policy" "errors" {
  display_name          = "Darkgrade telemetry error rate"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "More than 5 percent HTTP 5xx for five minutes"
    condition_threshold {
      filter             = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${google_cloud_run_v2_service.collector.name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\""
      denominator_filter = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${google_cloud_run_v2_service.collector.name}\" AND metric.type = \"run.googleapis.com/request_count\""
      comparison         = "COMPARISON_GT"
      threshold_value    = 0.05
      duration           = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      denominator_aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_project_service.api]
}

resource "google_logging_metric" "cleanup_failures" {
  name   = "darkgrade_telemetry_cleanup_failures"
  filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.cleanup.name}\" AND (jsonPayload.failed>0 OR jsonPayload.failed=true)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "cleanup" {
  display_name          = "Darkgrade telemetry withdrawal retry failed"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "Withdrawal cleanup needs attention"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.cleanup_failures.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_billing_budget" "telemetry" {
  billing_account = var.billing_account
  display_name    = "Darkgrade telemetry monthly budget"
  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  depends_on = [google_project_service.api]
}

resource "google_service_account" "deploy" {
  account_id = "darkgrade-telemetry-deploy"
  depends_on = [google_project_service.api]
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "darkgrade-telemetry-github"
  depends_on                = [google_project_service.api]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject" = "assertion.sub", "attribute.repository" = "assertion.repository", "attribute.ref" = "assertion.ref"
  }
  attribute_condition = "assertion.repository == 'darkgrade/darkgrade' && assertion.ref == '${var.deploy_ref}'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/darkgrade/darkgrade"
}

resource "google_project_iam_member" "deploy_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_artifact_registry_repository_iam_member" "deploy_images" {
  repository = google_artifact_registry_repository.telemetry.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_act_as" {
  service_account_id = google_service_account.collector.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

output "collector_url" {
  value = google_cloud_run_v2_service.collector.uri
}

output "registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.telemetry.repository_id}"
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account" {
  value = google_service_account.deploy.email
}
