variable "notification_channels" {
  description = "Existing verified Cloud Monitoring channel IDs. Empty creates console incidents only."
  type        = list(string)
  default     = []
}

resource "google_monitoring_uptime_check_config" "collector" {
  display_name = "Darkgrade telemetry HTTPS and database"
  timeout      = "10s"
  period       = "60s"
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(var.public_url, "https://")
    }
  }
  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  depends_on = [google_project_iam_member.bootstrap_monitoring, google_project_service.api]
}

resource "google_monitoring_alert_policy" "collector" {
  display_name          = "Darkgrade telemetry unavailable"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "HTTPS/database check failing for five minutes"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.collector.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
      trigger { count = 2 }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "database_capacity" {
  for_each = {
    cpu  = { threshold = 0.85, duration = "900s" }
    disk = { threshold = 0.80, duration = "300s" }
  }
  display_name          = "Darkgrade telemetry Postgres ${each.key} pressure"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "Sustained ${each.key} utilization"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.telemetry.name}\" AND metric.type=\"cloudsql.googleapis.com/database/${each.key}/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = each.value.duration
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
  depends_on = [google_project_iam_member.bootstrap_monitoring, google_project_service.api]
}
