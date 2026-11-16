terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "6.0.0" }
  }
  backend "gcs" {}
}
variable "project_id" { type = string }
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
    error_message = "Use the public HTTPS origin without a trailing slash."
  }
}
variable "database_password" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.database_password) >= 32
    error_message = "Use a random database password of at least 32 characters."
  }
}
variable "admin_key" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.admin_key) >= 32
    error_message = "Use a random operator password of at least 32 characters."
  }
}
variable "allowed_origins" {
  type    = list(string)
  default = []
}
variable "email_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "email_from" {
  type    = string
  default = ""
}
variable "deploy_ref" {
  type    = string
  default = "refs/heads/main"
}
variable "bootstrap_principal" {
  type    = string
  default = ""
  validation {
    condition     = var.bootstrap_principal == "" || can(regex("^(user|serviceAccount):[^ ]+@[^ ]+$", var.bootstrap_principal))
    error_message = "Use a user or serviceAccount IAM principal, or leave empty."
  }
}
provider "google" {
  project = var.project_id
  region  = var.region
}
resource "google_project_service" "api" {
  for_each           = toset(["run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "monitoring.googleapis.com", "billingbudgets.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}
resource "google_artifact_registry_repository" "telemetry" {
  repository_id = "darkgrade-telemetry"
  location      = var.region
  format        = "DOCKER"
  depends_on    = [google_project_service.api]
}
resource "google_sql_database_instance" "telemetry" {
  name                = "darkgrade-telemetry"
  database_version    = "POSTGRES_17"
  region              = var.region
  deletion_protection = true
  settings {
    # Concurrent bench uploads and Matrix export exhausted the shared micro instance.
    tier            = "db-custom-1-3840"
    edition         = "ENTERPRISE"
    disk_size       = 10
    disk_autoresize = true
    deletion_protection_enabled = true
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
    ip_configuration {
      ipv4_enabled = true
      ssl_mode = "ENCRYPTED_ONLY"
      # No authorized networks. Only the authenticated Cloud SQL connector can connect.
    }
  }
  depends_on = [google_project_service.api]
}
resource "google_sql_database" "telemetry" {
  name     = "telemetry"
  instance = google_sql_database_instance.telemetry.name
}
resource "google_sql_user" "collector" {
  name     = "telemetry"
  instance = google_sql_database_instance.telemetry.name
  password = var.database_password
}
resource "google_service_account" "collector" {
  account_id = "darkgrade-telemetry"
  depends_on = [google_project_service.api]
}
resource "google_service_account_iam_member" "bootstrap_act_as" {
  count              = var.bootstrap_principal == "" ? 0 : 1
  service_account_id = google_service_account.collector.name
  role               = "roles/iam.serviceAccountUser"
  member             = var.bootstrap_principal
}
resource "google_project_iam_member" "bootstrap_monitoring" {
  count   = var.bootstrap_principal == "" ? 0 : 1
  project = var.project_id
  role    = "roles/monitoring.editor"
  member  = var.bootstrap_principal
}
resource "google_project_iam_member" "sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.collector.email}"
}
resource "google_secret_manager_secret" "configuration" {
  for_each  = toset(concat(["database", "operator"], nonsensitive(var.email_api_key != "") ? ["email"] : []))
  secret_id = "darkgrade-telemetry-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}
resource "google_secret_manager_secret_version" "email" {
  count       = nonsensitive(var.email_api_key != "") ? 1 : 0
  secret      = google_secret_manager_secret.configuration["email"].id
  secret_data = var.email_api_key
  lifecycle {
    precondition {
      condition     = var.email_from != "" && !can(regex("[\\r\\n]", var.email_from))
      error_message = "Configure the verified sender address with the email key."
    }
  }
}
resource "google_secret_manager_secret_version" "database" {
  secret      = google_secret_manager_secret.configuration["database"].id
  secret_data = "postgresql://telemetry:${urlencode(var.database_password)}@localhost/telemetry?host=${urlencode("/cloudsql/${google_sql_database_instance.telemetry.connection_name}")}"
}
resource "google_secret_manager_secret_version" "operator" {
  secret      = google_secret_manager_secret.configuration["operator"].id
  secret_data = var.admin_key
}
resource "google_secret_manager_secret_iam_member" "configuration" {
  for_each  = google_secret_manager_secret.configuration
  secret_id = each.value.id
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
      # One resident web process runs cleanup too: no separate scheduler or job.
      min_instance_count = 1
      max_instance_count = 2
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = [google_sql_database_instance.telemetry.connection_name] }
    }
    containers {
      image = var.collector_image
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = false
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.configuration["database"].secret_id
            version = google_secret_manager_secret_version.database.version
          }
        }
      }
      env {
        name = "TELEMETRY_ADMIN_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.configuration["operator"].secret_id
            version = google_secret_manager_secret_version.operator.version
          }
        }
      }
      env {
        name  = "TELEMETRY_PUBLIC_URL"
        value = var.public_url
      }
      env {
        name  = "TELEMETRY_ALLOWED_ORIGINS"
        value = jsonencode(var.allowed_origins)
      }
      dynamic "env" {
        for_each = nonsensitive(var.email_api_key != "") ? [1] : []
        content {
          name = "TELEMETRY_EMAIL_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.configuration["email"].secret_id
              version = google_secret_manager_secret_version.email[0].version
            }
          }
        }
      }
      dynamic "env" {
        for_each = nonsensitive(var.email_api_key != "") ? [1] : []
        content {
          name = "TELEMETRY_EMAIL_FROM"
          value = var.email_from
        }
      }
      startup_probe {
        http_get { path = "/healthz" }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 12
      }
    }
  }
  depends_on = [google_project_service.api, google_secret_manager_secret_iam_member.configuration, google_project_iam_member.sql, google_service_account_iam_member.bootstrap_act_as, google_sql_database.telemetry, google_sql_user.collector]
}
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.collector.name
  role     = "roles/run.invoker"
  member   = "allUsers"
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
