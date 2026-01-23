#!/bin/bash

# Script to generate Kubernetes deployment with APP_PORT from secret
# Usage: ./generate-deployment.sh [namespace] [secret-name]

set -e

NAMESPACE=${1:-social-network-dev}
SECRET_NAME=${2:-file-service-env-vars}

echo "Generating deployment for worky-file-service..."
echo "Namespace: $NAMESPACE"
echo "Secret: $SECRET_NAME"

# Get APP_PORT from secret
APP_PORT=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.APP_PORT}' 2>/dev/null | base64 -d || echo "3005")

if [ -z "$APP_PORT" ]; then
  APP_PORT="3005"
fi

echo "Using APP_PORT: $APP_PORT"

# Create a temporary deployment file with the port
cat > deployment.tmp.yaml <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: files-pvc
  namespace: $NAMESPACE
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: file-service
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: file-service
  template:
    metadata:
      labels:
        app: file-service
    spec:
      containers:
      - name: file-service
        image: socialworky/worky-file-service-dev:5b5f4f28eb13f9dd785862264275ce11a0b0c8ea
        ports:
        - name: http
          containerPort: $APP_PORT
          protocol: TCP

        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"

        livenessProbe:
          httpGet:
            path: /health/live
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        readinessProbe:
          httpGet:
            path: /health/ready
            port: http
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3

        envFrom:
        - secretRef:
            name: $SECRET_NAME

        volumeMounts:
        - name: file-storage
          mountPath: /app/uploads

      volumes:
      - name: file-storage
        persistentVolumeClaim:
          claimName: files-pvc
EOF

# Create a temporary service file with the port
cat > service.tmp.yaml <<EOF
apiVersion: v1
kind: Service
metadata:
  name: file-service-svc
  namespace: $NAMESPACE
spec:
  selector:
    app: file-service
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: $APP_PORT
  type: ClusterIP
EOF

echo ""
echo "Generated files:"
echo "  - deployment.tmp.yaml (containerPort: $APP_PORT)"
echo "  - service.tmp.yaml (targetPort: $APP_PORT)"
echo ""
echo "To apply:"
echo "  kubectl apply -f deployment.tmp.yaml"
echo "  kubectl apply -f service.tmp.yaml"
echo ""
echo "Or review and copy to deployment.yaml and service.yaml"
