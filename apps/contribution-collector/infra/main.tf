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
variable "collector_image" {
  type        = string
  description = "Reviewed collector image pinned by digest."
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.collector_image))
    error_message = "Pin the image by sha256 digest."
  }
}
variable "signing_secret_id" {
  type        = string
  description = "Existing Secret Manager secret containing a random key of at least 32 bytes. No secret value in Terraform state."
}
variable "signing_secret_version" {
  type        = string
  description = "Explicit secret version, not latest. Preserve old-key withdrawal before rotating."
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.signing_secret_version))
    error_message = "Pin a numeric secret version."
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "api" {
  for_each           = toset(["run.googleapis.com", "storage.googleapis.com", "secretmanager.googleapis.com", "iam.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "collector" {
  account_id   = "darkgrade-contributions"
  display_name = "Darkgrade private contribution collector"
  depends_on   = [google_project_service.api]
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

resource "google_secret_manager_secret_iam_member" "signing" {
  project   = var.project_id
  secret_id = var.signing_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_cloud_run_v2_service" "collector" {
  name     = "darkgrade-contributions"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = google_service_account.collector.email
    timeout                          = "30s"
    max_instance_request_concurrency = 8
    scaling {
      min_instance_count = 0
      max_instance_count = 2
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
        name = "CONTRIBUTION_SIGNING_KEY"
        value_source {
          secret_key_ref {
            secret  = var.signing_secret_id
            version = var.signing_secret_version
          }
        }
      }
    }
  }
  depends_on = [google_project_service.api, google_storage_bucket_iam_member.collector, google_secret_manager_secret_iam_member.signing]
}

# HTTPS endpoint is reachable by clients; every data operation requires a scoped signed grant.
# No anonymous enrollment route, object read endpoint or public bucket is provided.
resource "google_cloud_run_v2_service_iam_member" "endpoint" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.collector.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "collector_url" { value = google_cloud_run_v2_service.collector.uri }
output "private_bucket" { value = google_storage_bucket.contributions.name }
